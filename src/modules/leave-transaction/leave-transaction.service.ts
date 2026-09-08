import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '../../../prisma/generated/client';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationService } from '../notification/notification.service';
import { isEligible } from '../../common/utils/eligibility.util';

type TxClient = Prisma.TransactionClient | PrismaService;

const SYSTEM_ACTOR_LABEL = 'Génération automatique des acquisitions';

@Injectable()
export class LeaveTransactionService {
  private readonly logger = new Logger(LeaveTransactionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
  ) {}

  findAll(employeeId?: string) {
    return this.prisma.leaveTransaction.findMany({
      where: employeeId ? { EmployeeId: employeeId } : undefined,
      include: {
        leaveType: {
          select: { Id: true, Name: true, Code: true, Color: true },
        },
      },
      orderBy: { CreatedAt: 'desc' },
    });
  }

  // Solde par type de conge pour un employe — lu directement depuis
  // EmployeeLeaveBalance (cache maintenu a jour par creditBalance/debitBalance
  // ci-dessous), pas recalcule a partir du ledger a chaque appel.
  async getBalances(employeeId: string) {
    const [employee, balances, leaveTypes] = await Promise.all([
      this.prisma.employee.findUniqueOrThrow({
        where: { Id: employeeId },
        select: { Gender: true, IsExpatriate: true, OrganizationUnitId: true },
      }),
      this.prisma.employeeLeaveBalance.findMany({
        where: { EmployeeId: employeeId },
      }),
      this.prisma.leaveType.findMany({ where: { IsActive: true } }),
    ]);

    return leaveTypes
      .filter((lt) => isEligible(lt, employee))
      .map((lt) => ({
        leaveTypeId: lt.Id,
        leaveTypeName: lt.Name,
        leaveTypeCode: lt.Code,
        color: lt.Color,
        daysPerYear: Number(lt.DaysPerYear),
        balance: Number(
          balances.find((b) => b.LeaveTypeId === lt.Id)?.Balance ?? 0,
        ),
      }));
  }

  // Vue RH : solde de tous les employes actifs, tous types confondus — pour
  // le tableau recapitulatif (LeaveBalancesView.vue). Le filtrage
  // d'eligibilite (genre/expatrie/entite) est propre a chaque employe, donc
  // recalcule ligne par ligne plutot que sur une liste de types commune.
  async getAllBalances() {
    const [employees, balances, leaveTypes] = await Promise.all([
      this.prisma.employee.findMany({
        where: {
          Status: { in: ['Active', 'OnTrial'] },
          IsSystem: false,
          IsDeleted: false,
        },
        select: {
          Id: true,
          FullName: true,
          Gender: true,
          IsExpatriate: true,
          OrganizationUnitId: true,
          organizationUnit: { select: { Name: true } },
        },
      }),
      this.prisma.employeeLeaveBalance.findMany(),
      this.prisma.leaveType.findMany({ where: { IsActive: true } }),
    ]);

    return employees.map((employee) => ({
      employeeId: employee.Id,
      employeeName: employee.FullName,
      entityName: employee.organizationUnit?.Name ?? '',
      balances: leaveTypes
        .filter((lt) => isEligible(lt, employee))
        .map((lt) => ({
          leaveTypeId: lt.Id,
          leaveTypeName: lt.Name,
          leaveTypeCode: lt.Code,
          color: lt.Color,
          daysPerYear: Number(lt.DaysPerYear),
          balance: Number(
            balances.find(
              (b) => b.EmployeeId === employee.Id && b.LeaveTypeId === lt.Id,
            )?.Balance ?? 0,
          ),
        })),
    }));
  }

  // Credite (ou debite si type='Consumption') le solde en cache d'un employe
  // pour un type de conge donne, et trace le mouvement dans LeaveTransaction
  // pour l'audit. Utilise par generateAccruals ci-dessous ET par
  // LeaveRequestService (consommation a l'approbation, reversement a
  // l'annulation) — c'est le point d'entree unique qui garde les deux en
  // phase.
  //
  // Le solde ne descend jamais sous 0 : un debit qui depasserait le solde
  // disponible est plafonne (ex. solde 3j, decrement de 5j demande -> solde
  // ramene a 0, pas -2j). Le mouvement trace dans LeaveTransaction reflete le
  // montant reellement applique (plafonne), pas le montant demande — sinon
  // le grand livre ne correspondrait plus au solde affiche. wasClamped
  // permet a l'appelant de signaler la difference a l'utilisateur.
  //
  // Lecture-puis-ecriture, pas atomique vis-a-vis d'ecritures concurrentes
  // sur le meme (employe, type) — acceptable a l'echelle de cette
  // application (pas de verrou optimiste sur EmployeeLeaveBalance).
  async adjustBalance(
    employeeId: string,
    leaveTypeId: string,
    amount: number,
    type: 'Acquisition' | 'Consumption',
    actorId: string,
    leaveRequestId?: string,
    client: TxClient = this.prisma,
    // 'Manual' uniquement depuis creditManual (ajustement ponctuel via
    // "Ajuster un solde") — tous les autres appelants (accrual automatique,
    // consommation/reversement lies a une demande de conge) restent 'System'
    // par defaut, voir generateAccruals ci-dessous qui s'appuie dessus.
    source: 'System' | 'Manual' = 'System',
  ) {
    const now = new Date();
    const current = await this.getBalance(employeeId, leaveTypeId, client);
    const requestedDelta = type === 'Acquisition' ? amount : -amount;
    const newBalance = Math.max(0, current + requestedDelta);
    const appliedMagnitude = Math.abs(newBalance - current);
    const wasClamped = appliedMagnitude < amount;

    await client.employeeLeaveBalance.upsert({
      where: {
        EmployeeId_LeaveTypeId: {
          EmployeeId: employeeId,
          LeaveTypeId: leaveTypeId,
        },
      },
      create: {
        EmployeeId: employeeId,
        LeaveTypeId: leaveTypeId,
        Balance: newBalance,
      },
      update: { Balance: newBalance, ModifiedAt: now },
    });
    await client.leaveTransaction.create({
      data: {
        EmployeeId: employeeId,
        LeaveTypeId: leaveTypeId,
        Type: type,
        Days: appliedMagnitude,
        StartDate: now,
        EndDate: now,
        LeaveRequestId: leaveRequestId,
        CreatedBy: actorId,
        Source: source,
      },
    });
    return { newBalance, appliedMagnitude, wasClamped };
  }

  async getBalance(
    employeeId: string,
    leaveTypeId: string,
    client: TxClient = this.prisma,
  ): Promise<number> {
    const row = await client.employeeLeaveBalance.findUnique({
      where: {
        EmployeeId_LeaveTypeId: {
          EmployeeId: employeeId,
          LeaveTypeId: leaveTypeId,
        },
      },
    });
    return Number(row?.Balance ?? 0);
  }

  // Genere les credits d'acquisition :
  // - types a accumulation mensuelle -> credite DaysPerMonth a chaque appel
  // - types a dotation annuelle (MonthlyAccrual=false) -> credite DaysPerYear
  //   une seule fois par an (uniquement si aucune Acquisition n'existe deja
  //   pour ce type sur l'annee en cours)
  // Idempotence best-effort : le worker appelant (cron ou déclenchement
  // manuel) est responsable de ne pas relancer deux fois le même mois — voir
  // AccrualSchedulerService.LastLeaveAccrualRunAt.
  //
  // opts.employeeId / opts.leaveTypeId restreignent la generation a un seul
  // employe et/ou un seul type — utilise pour les deux declencheurs
  // ponctuels (nouvel employe credite sur les types deja actifs, nouveau
  // type credite retroactivement aux employes deja presents), qui doivent
  // reutiliser exactement la meme regle (mois en cours pour le mensuel,
  // annee complete pour l'annuel) sans dupliquer la logique ci-dessus.
  // Un appel restreint (employeeId ou leaveTypeId fourni) ne met PAS a jour
  // CompanySettings.LastLeaveAccrualRunAt : ce timestamp signifie "la
  // generation complete de l'entreprise a eu lieu ce mois-ci" et ne doit pas
  // etre modifie par un credit partiel, sous peine de faire croire au cron
  // (ou au bouton "Générer maintenant") qu'un cycle complet a deja tourne.
  async generateAccruals(
    triggeredBy: string,
    opts?: { employeeId?: string; leaveTypeId?: string },
  ) {
    const now = new Date();
    const currentYear = now.getFullYear();
    const yearStart = new Date(Date.UTC(currentYear, 0, 1));
    const monthStart = new Date(Date.UTC(currentYear, now.getMonth(), 1));
    const isScoped = !!(opts?.employeeId || opts?.leaveTypeId);

    const [employees, leaveTypes] = await Promise.all([
      this.prisma.employee.findMany({
        where: {
          Status: { in: ['Active', 'OnTrial'] },
          IsSystem: false,
          IsDeleted: false,
          ...(opts?.employeeId ? { Id: opts.employeeId } : {}),
        },
        select: { Id: true },
      }),
      this.prisma.leaveType.findMany({
        where: {
          IsActive: true,
          ...(opts?.leaveTypeId ? { Id: opts.leaveTypeId } : {}),
        },
      }),
    ]);

    let created = 0;
    for (const leaveType of leaveTypes) {
      const daysPerYear = Number(leaveType.DaysPerYear);
      if (daysPerYear <= 0) continue;

      if (leaveType.MonthlyAccrual) {
        const amount =
          leaveType.DaysPerMonth != null
            ? Number(leaveType.DaysPerMonth)
            : daysPerYear / 12;
        for (const employee of employees) {
          // Un employe ne doit recevoir qu'UN SEUL credit mensuel par
          // periode (mois calendaire) pour un type donne — sans cette
          // verification, un double declenchement le meme mois (ex: cron +
          // clic manuel sur "Générer maintenant", ou creation d'employe le
          // meme mois qu'un cycle deja passe) le creditait deux fois. Meme
          // logique de garde que la branche annuelle ci-dessous, juste sur
          // une fenetre mensuelle plutot qu'annuelle.
          const alreadyGrantedThisMonth =
            await this.prisma.leaveTransaction.findFirst({
              where: {
                EmployeeId: employee.Id,
                LeaveTypeId: leaveType.Id,
                Type: 'Acquisition',
                Source: 'System',
                CreatedAt: { gte: monthStart },
                LeaveRequestId: null,
              },
            });
          if (alreadyGrantedThisMonth) continue;
          await this.adjustBalance(
            employee.Id,
            leaveType.Id,
            amount,
            'Acquisition',
            triggeredBy,
          );
          created++;
        }
      } else {
        for (const employee of employees) {
          const alreadyGranted = await this.prisma.leaveTransaction.findFirst({
            where: {
              EmployeeId: employee.Id,
              LeaveTypeId: leaveType.Id,
              Type: 'Acquisition',
              Source: 'System',
              CreatedAt: { gte: yearStart },
              LeaveRequestId: null,
            },
          });
          if (alreadyGranted) continue;
          await this.adjustBalance(
            employee.Id,
            leaveType.Id,
            daysPerYear,
            'Acquisition',
            triggeredBy,
          );
          created++;
        }
      }
    }

    if (!isScoped) {
      await this.prisma.companySettings.updateMany({
        data: { LastLeaveAccrualRunAt: now },
      });
    }
    this.logger.log(`${SYSTEM_ACTOR_LABEL} : ${created} crédit(s) appliqué(s)`);
    return { created, runAt: now };
  }

  // Credit ponctuel et manuel (ex: regularisation, geste commercial, oubli
  // de generation) — distinct de generateAccruals qui ne fait que la routine
  // mensuelle/annuelle standard. Passe par adjustBalance, donc trace lui
  // aussi dans LeaveTransaction pour l'audit.
  //
  // Un montant negatif decremente le solde (type Consumption) au lieu de le
  // crediter — plafonne a 0 par adjustBalance, jamais de solde negatif en
  // base. reason reste informatif (affiche cote UI) — pas encore persiste,
  // LeaveTransaction n'a pas de colonne dediee.
  async creditManual(
    employeeId: string,
    leaveTypeId: string,
    amount: number,
    reason: string | undefined,
    actorId: string,
  ) {
    if (amount === 0) {
      throw new BadRequestException('Le nombre de jours ne peut pas être 0.');
    }
    const type = amount > 0 ? 'Acquisition' : 'Consumption';
    const result = await this.adjustBalance(
      employeeId,
      leaveTypeId,
      Math.abs(amount),
      type,
      actorId,
      undefined,
      this.prisma,
      'Manual',
    );

    const leaveType = await this.prisma.leaveType.findUnique({
      where: { Id: leaveTypeId },
      select: { Name: true },
    });
    const verb = amount > 0 ? 'crédité de' : 'débité de';
    await this.notifications.create({
      employeeId,
      type: 'system',
      title: 'Solde de congé ajusté',
      message: `Votre solde de ${leaveType?.Name ?? 'congé'} a été ${verb} ${Math.abs(amount)} jour(s) par le service RH${reason ? ` (${reason})` : ''}.`,
      href: '/employee/absences',
    });

    return {
      balances: await this.getBalances(employeeId),
      wasClamped: result.wasClamped,
      newBalance: result.newBalance,
    };
  }

  // Fixe le solde a une valeur absolue — import des soldes initiaux (demande
  // client confirmee le 08/09 : "remplacer" et non "ajouter", contrairement a
  // creditManual ci-dessus qui reste un delta relatif pour l'ajustement
  // ponctuel manuel, comportement inchange). Calcule le delta necessaire pour
  // atteindre la cible puis reutilise creditManual (meme tracabilite dans
  // LeaveTransaction, meme notification employe) — evite de dupliquer cette
  // logique. delta === 0 : deja a la bonne valeur, ne declenche ni mouvement
  // ni notification (reimporter le meme fichier plusieurs fois reste neutre).
  async setBalance(
    employeeId: string,
    leaveTypeId: string,
    targetBalance: number,
    reason: string | undefined,
    actorId: string,
  ) {
    const current = await this.getBalance(employeeId, leaveTypeId);
    const delta = targetBalance - current;
    if (delta === 0) {
      return {
        balances: await this.getBalances(employeeId),
        wasClamped: false,
        newBalance: current,
      };
    }
    return this.creditManual(employeeId, leaveTypeId, delta, reason, actorId);
  }
}

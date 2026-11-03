import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '../../../prisma/generated/client';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationService } from '../notification/notification.service';
import { isEligible } from '../../common/utils/eligibility.util';
import { ListQuery } from '../../common/utils/list-query.util';

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
    const [employees, balances, leaveTypes, directory] = await Promise.all([
      this.prisma.employee.findMany({
        where: {
          Status: { in: ['Active', 'OnTrial'] },
          IsSystem: false,
          IsDeleted: false,
        },
        select: {
          Id: true,
          EmployeeNumber: true,
          FirstName: true,
          LastName: true,
          FullName: true,
          Gender: true,
          IsExpatriate: true,
          OrganizationUnitId: true,
          organizationUnit: { select: { Name: true } },
        },
      }),
      this.prisma.employeeLeaveBalance.findMany(),
      this.prisma.leaveType.findMany({ where: { IsActive: true } }),
      // Rang de chaque employe dans la liste des employes (meme requete, meme
      // ordre que GET /employees) : le frontend en tire la couleur d'avatar,
      // ce qui lui evite de charger toute la liste des employes juste pour ca.
      this.prisma.employee.findMany({
        where: { IsSystem: false, IsDeleted: false },
        select: { Id: true },
      }),
    ]);
    const paletteIndexOf = new Map(directory.map((e, i) => [e.Id, i]));

    return employees.map((employee) => ({
      employeeId: employee.Id,
      initials: (employee.FirstName.charAt(0) + employee.LastName.charAt(0)).toUpperCase(),
      paletteIndex: paletteIndexOf.get(employee.Id) ?? 0,
      // Matricule : utilise par l'export configurable (import Sage paie).
      employeeNumber: employee.EmployeeNumber,
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

  // Page de soldes (ecran "Soldes" et widget du tableau de bord) : meme forme
  // de ligne que getAllBalances, mais pagine, recherche et trie cote serveur.
  //  - entity : nom de l'entite (filtre)
  //  - sort   : 'name' (defaut) ou l'identifiant d'un type de conge (tri sur le solde)
  // `meta` porte ce qui ne depend ni du filtre ni de la page : nombre
  // d'employes suivis, colonnes (types de conge presents chez au moins un
  // employe eligible) et total des soldes par type sur toute l'entreprise.
  async getBalancesPage(q: ListQuery, f: { entity?: string }) {
    const tracked = {
      Status: { in: ['Active', 'OnTrial'] },
      IsSystem: false,
      IsDeleted: false,
    };
    const [all, leaveTypes, balances, directory] = await Promise.all([
      this.prisma.employee.findMany({
        where: tracked,
        select: {
          Id: true,
          FullName: true,
          Gender: true,
          IsExpatriate: true,
          OrganizationUnitId: true,
          organizationUnit: { select: { Name: true } },
        },
      }),
      this.prisma.leaveType.findMany({ where: { IsActive: true } }),
      this.prisma.employeeLeaveBalance.findMany({
        select: { EmployeeId: true, LeaveTypeId: true, Balance: true },
      }),
      this.prisma.employee.findMany({
        where: { IsSystem: false, IsDeleted: false },
        select: { Id: true },
      }),
    ]);

    const balanceOf = new Map(
      balances.map((b) => [`${b.EmployeeId}|${b.LeaveTypeId}`, Number(b.Balance)] as [string, number]),
    );
    const eligible = (e: (typeof all)[number]) => leaveTypes.filter((lt) => isEligible(lt, e));

    // Meta sur l'ensemble des employes suivis.
    const totals = new Map<string, number>();
    const columnIds = new Set<string>();
    for (const e of all) {
      for (const lt of eligible(e)) {
        columnIds.add(lt.Id);
        totals.set(lt.Id, (totals.get(lt.Id) ?? 0) + (balanceOf.get(`${e.Id}|${lt.Id}`) ?? 0));
      }
    }
    const columns = leaveTypes
      .filter((lt) => columnIds.has(lt.Id))
      .map((lt) => ({
        leaveTypeId: lt.Id,
        leaveTypeName: lt.Name,
        leaveTypeCode: lt.Code,
        color: lt.Color,
        daysPerYear: Number(lt.DaysPerYear),
        total: Math.round((totals.get(lt.Id) ?? 0) * 100) / 100,
      }));

    // Filtre, recherche et tri sur la liste legere, puis on ne detaille que la page.
    const needle = q.search?.toLowerCase();
    let list = all.filter(
      (e) =>
        (!f.entity || e.organizationUnit?.Name === f.entity) &&
        (!needle || e.FullName.toLowerCase().includes(needle)),
    );
    const sortByType = q.sort && q.sort !== 'name' && leaveTypes.some((lt) => lt.Id === q.sort);
    list = [...list].sort((a, b) => {
      const cmp = sortByType
        ? (balanceOf.get(`${a.Id}|${q.sort}`) ?? 0) - (balanceOf.get(`${b.Id}|${q.sort}`) ?? 0)
        : a.FullName.localeCompare(b.FullName, 'fr');
      return q.dir === 'desc' ? -cmp : cmp;
    });
    const total = list.length;
    const pageRows = list.slice((q.page - 1) * q.pageSize, q.page * q.pageSize);

    const details = pageRows.length
      ? await this.prisma.employee.findMany({
          where: { Id: { in: pageRows.map((e) => e.Id) } },
          select: { Id: true, EmployeeNumber: true, FirstName: true, LastName: true },
        })
      : [];
    const detailOf = new Map(details.map((d) => [d.Id, d]));
    const paletteIndexOf = new Map(directory.map((e, i) => [e.Id, i] as [string, number]));

    const items = pageRows.map((e) => {
      const d = detailOf.get(e.Id);
      return {
        employeeId: e.Id,
        employeeNumber: d?.EmployeeNumber,
        employeeName: e.FullName,
        initials: d ? (d.FirstName.charAt(0) + d.LastName.charAt(0)).toUpperCase() : '',
        paletteIndex: paletteIndexOf.get(e.Id) ?? 0,
        entityName: e.organizationUnit?.Name ?? '',
        balances: eligible(e).map((lt) => ({
          leaveTypeId: lt.Id,
          leaveTypeName: lt.Name,
          leaveTypeCode: lt.Code,
          color: lt.Color,
          daysPerYear: Number(lt.DaysPerYear),
          balance: balanceOf.get(`${e.Id}|${lt.Id}`) ?? 0,
        })),
      };
    });
    return { items, total, meta: { tracked: all.length, columns } };
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
  //
  // Les generations sont executees une a la fois dans le processus : sans cela,
  // le cron et le bouton "Générer maintenant" lances au meme instant passeraient
  // tous deux le controle "deja credite ce mois-ci" avant que l'un des deux
  // n'ait ecrit, et crediteraient deux fois.
  private accrualQueue: Promise<unknown> = Promise.resolve();

  generateAccruals(
    triggeredBy: string,
    opts?: { employeeId?: string; leaveTypeId?: string },
  ) {
    const run = this.accrualQueue.then(() => this.generateAccrualsNow(triggeredBy, opts));
    this.accrualQueue = run.catch(() => undefined);
    return run;
  }

  private async generateAccrualsNow(
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
        // Genre / expatrie / entite : necessaires pour ne crediter un type
        // qu'aux employes auxquels il s'applique (voir isEligible ci-dessous).
        select: {
          Id: true,
          Gender: true,
          IsExpatriate: true,
          OrganizationUnitId: true,
        },
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
      // Type a credit manuel (maternite / paternite) : la RH alimente le solde
      // elle-meme quand le dossier est depose.
      if (leaveType.AutoAccrual === false) continue;

      // Seuls les employes concernes par le ciblage du type (genre,
      // expatrie, entite) sont credites. Sans ce filtre, un type reserve a un
      // genre (ex : conge maternite) etait credite a TOUS les employes : le
      // solde restait invisible a l'ecran (l'affichage filtre deja) mais
      // existait en base, et apparaissait des que le ciblage etait retire.
      const eligibleEmployees = employees.filter((e) => isEligible(leaveType, e));

      if (leaveType.MonthlyAccrual) {
        const amount =
          leaveType.DaysPerMonth != null
            ? Number(leaveType.DaysPerMonth)
            : daysPerYear / 12;
        for (const employee of eligibleEmployees) {
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
        for (const employee of eligibleEmployees) {
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

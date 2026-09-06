import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../../../prisma/generated/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';
import { LeaveTransactionService } from '../leave-transaction/leave-transaction.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { bulkImport } from '../../common/utils/bulk-import.util';

type TxClient = Prisma.TransactionClient | PrismaService;

@Injectable()
export class EmployeeService {
  private readonly logger = new Logger(EmployeeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly leaveTransactionService: LeaveTransactionService,
    private readonly realtime: RealtimeGateway,
  ) {}

  // Matricule genere cote serveur (compte les EmployeeNumber "EMP..." existants,
  // en ignorant les autres prefixes eventuels comme les comptes de seed) —
  // evite les collisions du generateur cote frontend (qui se basait sur la
  // liste d'employes deja chargee en memoire, potentiellement incomplete).
  // Reste une suggestion : le champ est pre-rempli mais modifiable, la
  // contrainte @unique + le filtre Prisma font foi en dernier recours.
  async generateEmployeeNumber(): Promise<string> {
    const count = await this.prisma.employee.count({
      where: { EmployeeNumber: { startsWith: 'EMP' } },
    });
    return `EMP${String(count + 1).padStart(3, '0')}`;
  }

  // L'occupation d'un poste (Vacant/Occupé) n'est plus stockee — un poste a
  // desormais une Capacity (N sieges), recomptee ici a chaque affectation
  // pour empecher de depasser le nombre de places disponibles (voir decision
  // du 30/07). Le frontend filtre deja les postes complets de la liste, ceci
  // est le filet de securite cote serveur.
  private async assertPositionHasCapacity(tx: TxClient, positionId: string) {
    const position = await tx.position.findUnique({
      where: { Id: positionId },
      include: { _count: { select: { employees: true } } },
    });
    if (!position) {
      throw new NotFoundException(`Poste ${positionId} introuvable`);
    }
    if (position._count.employees >= position.Capacity) {
      throw new BadRequestException(
        `Le poste « ${position.Title} » n'a plus de siège disponible`,
      );
    }
  }

  // Plan de tests #35 : une date d'embauche antérieure à la date de
  // naissance était acceptée sans contrôle.
  private assertHireDateAfterBirthDate(birthDate: Date, hireDate: Date) {
    if (hireDate <= birthDate) {
      throw new BadRequestException(
        "La date d'embauche doit être postérieure à la date de naissance.",
      );
    }
  }

  async create(dto: CreateEmployeeDto, createdBy: string) {
    this.assertHireDateAfterBirthDate(dto.BirthDate, dto.HireDate);
    const employeeNumber =
      dto.EmployeeNumber?.trim() || (await this.generateEmployeeNumber());
    const employee = await this.prisma.$transaction(async (tx) => {
      if (dto.PositionId) {
        await this.assertPositionHasCapacity(tx, dto.PositionId);
      }
      return tx.employee.create({
        data: {
          ...dto,
          EmployeeNumber: employeeNumber,
          FullName: `${dto.FirstName} ${dto.LastName}`,
          CreatedBy: createdBy,
        },
      });
    });

    // Credite le nouvel employe sur les types de conge deja actifs — mois en
    // cours pour l'accumulation mensuelle, annee complete pour la dotation
    // annuelle (meme regle que generateAccruals, voir sa doc). Ne bloque pas
    // la creation de l'employe si le credit echoue.
    await this.leaveTransactionService
      .generateAccruals(createdBy, { employeeId: employee.Id })
      .catch((err) => {
        this.logger.warn(
          `Crédit initial des congés échoué pour l'employé ${employee.Id} : ${err.message}`,
        );
      });

    this.realtime.broadcastCompany('data:changed', { domain: 'employee' });
    return employee;
  }

  // Import CSV (Lot D) — voir common/utils/bulk-import.util.ts. Passe par le
  // meme create() ligne par ligne (donc EmployeeNumber auto-genere, credit
  // initial des conges, verification de capacite du poste s'appliquent aussi
  // depuis un import) — sequentiel, voir la doc de bulkImport().
  bulkCreate(items: unknown[], createdBy: string) {
    return bulkImport(items, CreateEmployeeDto, (dto) =>
      this.create(dto, createdBy),
    );
  }

  // IsSystem exclut le compte d'amorcage seede ("Admin HV") — pas un
  // vrai membre du personnel, ne doit jamais apparaitre dans une liste ou
  // un selecteur (voir migration IsSystem + prisma/backfill-employee-is-system.ts).
  findAll() {
    return this.prisma.employee.findMany({
      where: { IsSystem: false, IsDeleted: false },
    });
  }

  // Annuaire minimal, ouvert a tout employe authentifie (pas de permission
  // EMPLOYE_VOIR_TOUT requise) — sert les selecteurs de beneficiaire/
  // interimaire (n'importe qui peut soumettre une demande pour n'importe
  // qui, decision du 01/08) sans exposer les champs sensibles (date de
  // naissance, numero de piece d'identite, etc.) que renvoie findAll().
  // N'exclut plus les employes Inactive (decision ulterieure) : ils
  // doivent rester visibles dans les selecteurs (griese, non cliquables,
  // voir front) plutot que disparaitre silencieusement — Status est donc
  // renvoye pour que le front sache griser. Seuls IsSystem/IsDeleted
  // restent des exclusions dures (comptes techniques / supprimes).
  findDirectory() {
    return this.prisma.employee.findMany({
      where: { IsSystem: false, IsDeleted: false },
      select: {
        Id: true,
        FirstName: true,
        LastName: true,
        FullName: true,
        EmployeeNumber: true,
        OrganizationUnitId: true,
        EmployeeCategoryId: true,
        Status: true,
        // Necessaire au calcul (cote frontend, apercu avant soumission) de
        // l'ajout du week-end au decompte de conges pour un beneficiaire
        // "local" — voir utils/calendar.ts et computeWorkingDays.
        IsExpatriate: true,
        // Necessaire au filtrage (cote frontend) des types de conge/jours
        // feries restreints par genre — voir eligibility.util.ts et
        // AbsenceCreate.vue. Pas une donnee sensible au meme titre que date
        // de naissance/numero de piece, ne casse pas la justification du
        // "minimal" de cet endpoint.
        Gender: true,
      },
      orderBy: { FullName: 'asc' },
    });
  }

  // "Son équipe" = les employés des unités organisationnelles que le
  // demandeur dirige (OrganizationUnit.ManagerId), y compris les sous-unités.
  async findTeam(managerEmployeeId: string) {
    const unitIds = await this.collectManagedUnitIds(managerEmployeeId);
    if (unitIds.length === 0) {
      return [];
    }
    return this.prisma.employee.findMany({
      where: {
        OrganizationUnitId: { in: unitIds },
        IsSystem: false,
        IsDeleted: false,
      },
    });
  }

  private async collectManagedUnitIds(
    managerEmployeeId: string,
  ): Promise<string[]> {
    const managedRoots = await this.prisma.organizationUnit.findMany({
      where: { ManagerId: managerEmployeeId },
      select: { Id: true },
    });

    const collected: string[] = [];
    const queue = managedRoots.map((unit) => unit.Id);
    while (queue.length > 0) {
      const currentId = queue.shift() as string;
      collected.push(currentId);
      const children = await this.prisma.organizationUnit.findMany({
        where: { ParentId: currentId },
        select: { Id: true },
      });
      queue.push(...children.map((child) => child.Id));
    }
    return collected;
  }

  async findOne(id: string) {
    const employee = await this.prisma.employee.findUnique({
      where: { Id: id },
    });
    if (!employee || employee.IsDeleted) {
      throw new NotFoundException(`Employé ${id} introuvable`);
    }
    return employee;
  }

  // Pas de permission dédiée pour consulter UNE fiche : tout utilisateur
  // connecté voit son propre dossier sans permission explicite ; au-delà,
  // il faut EMPLOYE_VOIR_TOUT (tous) ou EMPLOYE_VOIR_EQUIPE (dossier dans
  // son périmètre managérial).
  async findOneForRequester(
    id: string,
    requesterEmployeeId: string,
    permissions: Set<string>,
  ) {
    const employee = await this.findOne(id);

    if (id === requesterEmployeeId) {
      return employee;
    }
    if (permissions.has('EMPLOYE_VOIR_TOUT')) {
      return employee;
    }
    if (permissions.has('EMPLOYE_VOIR_EQUIPE')) {
      const managedUnitIds =
        await this.collectManagedUnitIds(requesterEmployeeId);
      if (managedUnitIds.includes(employee.OrganizationUnitId)) {
        return employee;
      }
    }

    throw new ForbiddenException(
      "Vous n'avez pas la permission de consulter ce dossier employé",
    );
  }

  async update(id: string, dto: UpdateEmployeeDto, modifiedBy: string) {
    // Meme regle que remove() ci-dessous : le formulaire d'edition permet
    // aussi de changer le Statut vers Inactive (dropdown), pas seulement le
    // bouton Desactiver dedie — les deux portes doivent etre bloquees.
    if (id === modifiedBy && dto.Status === 'Inactive') {
      throw new BadRequestException(
        'Vous ne pouvez pas désactiver votre propre compte.',
      );
    }
    const existing = await this.findOne(id);
    const FirstName = dto.FirstName ?? existing.FirstName;
    const LastName = dto.LastName ?? existing.LastName;
    this.assertHireDateAfterBirthDate(
      dto.BirthDate ?? existing.BirthDate,
      dto.HireDate ?? existing.HireDate,
    );

    // 'PositionId' in dto distinguishes "field omitted from the PATCH body"
    // (no change intended) from "field explicitly sent" (including null,
    // which means the employee is being unassigned from their position).
    const positionFieldSent = 'PositionId' in dto;
    const oldPositionId = existing.PositionId;
    const newPositionId = dto.PositionId;
    const positionChanged =
      positionFieldSent && newPositionId !== oldPositionId;

    return this.prisma.$transaction(async (tx) => {
      if (positionChanged && newPositionId) {
        await this.assertPositionHasCapacity(tx, newPositionId);
      }
      return tx.employee.update({
        where: { Id: id },
        data: {
          ...dto,
          FullName: `${FirstName} ${LastName}`,
          ModifiedBy: modifiedBy,
          ModifiedAt: new Date(),
        },
      });
    });
  }

  // Soft delete : l'employé reste en base (Status=Inactive) — un hard delete
  // casserait les références historiques (congés, missions, notes de frais
  // passées) qui pointent vers cet Id.
  async remove(id: string, requesterId: string) {
    if (id === requesterId) {
      throw new BadRequestException(
        'Vous ne pouvez pas désactiver votre propre compte.',
      );
    }
    await this.findOne(id);
    const employee = await this.prisma.employee.update({
      where: { Id: id },
      data: { Status: 'Inactive', PositionId: null, ModifiedAt: new Date() },
    });
    this.realtime.broadcastCompany('data:changed', { domain: 'employee' });
    return employee;
  }

  // Suppression definitive (Lot I) — distincte de remove()/deactivate
  // ci-dessus (Status=Inactive, reversible depuis l'app). IsDeleted=true
  // cache l'employe de tout l'app (findAll/findDirectory/findTeam/findOne
  // filtrent deja IsDeleted:false) sans toucher a l'historique (conges,
  // missions, notes de frais passees continuent de pointer vers son Id) —
  // seul un dev peut repasser IsDeleted a false directement en base.
  async softDelete(id: string, deletedBy: string) {
    if (id === deletedBy) {
      throw new BadRequestException(
        'Vous ne pouvez pas supprimer votre propre compte.',
      );
    }
    await this.findOne(id);
    const employee = await this.prisma.employee.update({
      where: { Id: id },
      data: { IsDeleted: true, DeletedBy: deletedBy, DeletedAt: new Date() },
    });
    this.realtime.broadcastCompany('data:changed', { domain: 'employee' });
    return employee;
  }
}

import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ApprovalPoolService } from '../approval-pool/approval-pool.service';
import { LeaveTransactionService } from '../leave-transaction/leave-transaction.service';
import { WorkflowNotifierService, WorkflowContext } from '../notification/workflow-notifier.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { formatDateFr } from '../mail/email-templates';
import { generateApprovalToken } from '../../common/approval-token';
import { CreateLeaveRequestDto } from './dto/create-leave-request.dto';
import { UpdateLeaveRequestDto } from './dto/update-leave-request.dto';
import { DecideLeaveRequestDto } from './dto/decide-leave-request.dto';

const DAY_KEYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// Statuts pendant lesquels une demande occupe un jour du calendrier de
// l'employe — utilise pour detecter les chevauchements.
const OVERLAPPING_STATUSES = [
  'Pending', 'InApprovalN1', 'InApprovalN2', 'InApprovalN3', 'InApprovalN4',
  'Approved', 'Registered', 'Done',
];

const EDITABLE_STATUSES = ['Draft', 'Returned'];

// Applique a chaque create/update mutant une demande — sans ça la reponse
// renvoyee par l'endpoint (utilisee par le front pour patcher sa liste en
// place) n'a pas employee/leaveType et la ligne s'affiche avec un nom et
// des initiales vides jusqu'au prochain rechargement complet.
const LEAVE_REQUEST_INCLUDE = {
  employee: { select: { Id: true, FullName: true, EmployeeNumber: true } },
  leaveType: true,
  interimEmployee: { select: { Id: true, FullName: true } },
  createdByEmployee: { select: { Id: true, FullName: true } },
} as const;

@Injectable()
export class LeaveRequestService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly approvalPoolService: ApprovalPoolService,
    private readonly leaveTransactionService: LeaveTransactionService,
    private readonly notifier: WorkflowNotifierService,
    private readonly realtime: RealtimeGateway,
  ) {}

  // ── Helpers ──────────────────────────────────────────────────────────

  private toContext(lr: {
    Id: string; ReferenceCode: string; EmployeeId: string; CreatedBy: string;
    StartDate: Date; EndDate: Date; DaysCount: unknown; leaveType?: { Name: string } | null;
  }): WorkflowContext {
    return {
      kind: 'leave',
      id: lr.Id,
      referenceCode: lr.ReferenceCode,
      beneficiaryId: lr.EmployeeId,
      creatorId: lr.CreatedBy,
      summary: lr.leaveType?.Name ?? 'congé',
      details: [
        { label: 'Type de congé', value: lr.leaveType?.Name ?? '—' },
        { label: 'Du', value: formatDateFr(lr.StartDate) },
        { label: 'Au', value: formatDateFr(lr.EndDate) },
        { label: 'Durée', value: `${Number(lr.DaysCount)} jour(s)` },
      ],
    };
  }

  private async generateReferenceCode(): Promise<string> {
    const year = new Date().getFullYear();
    const prefix = `DMD-${year}-`;
    const count = await this.prisma.leaveRequest.count({
      where: { ReferenceCode: { startsWith: prefix } },
    });
    return `${prefix}${String(count + 1).padStart(5, '0')}`;
  }

  // Solde insuffisant n'est plus bloquant a la soumission (decision du
  // 04/08, meme traitement que le preavis, voir routeToApproval) — cet
  // indicateur permet au front d'afficher l'avertissement en rouge sur les
  // ecrans de validation, calcule au moment de l'affichage (pas figé a la
  // soumission) puisque le solde peut evoluer entre-temps.
  private async attachBalanceFlag<
    T extends { EmployeeId: string; LeaveTypeId: string; DaysCount: unknown; leaveType?: { DaysPerYear: unknown } | null },
  >(item: T): Promise<T & { InsufficientBalance: boolean }> {
    const daysPerYear = Number(item.leaveType?.DaysPerYear ?? 0);
    if (daysPerYear <= 0) {
      return { ...item, InsufficientBalance: false };
    }
    const balance = await this.leaveTransactionService.getBalance(item.EmployeeId, item.LeaveTypeId);
    return { ...item, InsufficientBalance: balance < Number(item.DaysCount) };
  }

  private attachBalanceFlags<
    T extends { EmployeeId: string; LeaveTypeId: string; DaysCount: unknown; leaveType?: { DaysPerYear: unknown } | null },
  >(items: T[]): Promise<(T & { InsufficientBalance: boolean })[]> {
    return Promise.all(items.map((item) => this.attachBalanceFlag(item)));
  }

  // Remonte OrganizationUnit.ParentId jusqu'a la racine — reutilise pour
  // savoir si un jour ferie "Local" s'applique a l'employe.
  private async collectAncestorUnitIds(unitId: string): Promise<string[]> {
    const ids: string[] = [unitId];
    let currentId: string | null = unitId;
    while (currentId) {
      const unit = await this.prisma.organizationUnit.findUnique({
        where: { Id: currentId },
        select: { ParentId: true },
      });
      currentId = unit?.ParentId ?? null;
      if (currentId) ids.push(currentId);
    }
    return ids;
  }

  // Calendrier de la categorie du beneficiaire s'il en a un de dedie, sinon
  // le calendrier global par defaut (voir CalendarService.resolveForEmployee
  // — meme logique, dupliquee ici faute d'injection cross-module existante
  // pour ce service).
  private async resolveApplicableCalendar(employeeCategoryId: string | null) {
    if (employeeCategoryId) {
      const byCategory = await this.prisma.calendar.findFirst({
        where: { EmployeeCategoryId: employeeCategoryId },
        include: { workDays: true },
      });
      if (byCategory) return byCategory;
    }
    return this.prisma.calendar.findFirst({ where: { IsDefault: true }, include: { workDays: true } });
  }

  private async computeWorkingDays(
    startDate: Date,
    endDate: Date,
    organizationUnitId: string,
    employeeCategoryId: string | null,
    isExpatriate = false,
    startPeriod = 'full',
    endPeriod = 'full',
  ): Promise<number> {
    if (endDate < startDate) {
      throw new BadRequestException('La date de fin doit être postérieure ou égale à la date de début');
    }

    const calendar = await this.resolveApplicableCalendar(employeeCategoryId);
    if (!calendar) {
      throw new BadRequestException("Aucun calendrier par défaut n'est configuré — contactez le RH");
    }

    const holidays = await this.prisma.holiday.findMany();
    const applicableUnitIds = new Set(await this.collectAncestorUnitIds(organizationUnitId));

    const isWorkingDay = (date: Date): boolean => {
      const dayConfig = calendar.workDays.find((d) => d.DayOfWeek === DAY_KEYS[date.getDay()]);
      return !!dayConfig?.IsEnabled && !isHoliday(date);
    };

    const isHoliday = (date: Date): boolean => {
      const mm = String(date.getMonth() + 1).padStart(2, '0');
      const dd = String(date.getDate()).padStart(2, '0');
      return holidays.some((h) => {
        if (h.HolidayType === 'Local' && !(h.OrganizationUnitId && applicableUnitIds.has(h.OrganizationUnitId))) {
          return false;
        }
        const hd = h.Date;
        if (h.IsRecurring) {
          return hd.getUTCMonth() + 1 === Number(mm) && hd.getUTCDate() === Number(dd);
        }
        return (
          hd.getUTCFullYear() === date.getFullYear() &&
          hd.getUTCMonth() === date.getMonth() &&
          hd.getUTCDate() === date.getDate()
        );
      });
    };

    const sameDay = (a: Date, b: Date) =>
      a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

    // Vrai si `date` est une absence complete au sens de la demande — seuls
    // StartDate/EndDate peuvent porter une demi-journee (StartPeriod/
    // EndPeriod != 'full'), tout jour strictement entre les deux est
    // forcement une absence complete.
    const isFullyAbsent = (date: Date): boolean => {
      if (sameDay(date, startDate) && startPeriod !== 'full') return false;
      if (sameDay(date, endDate) && endPeriod !== 'full') return false;
      return true;
    };

    let count = 0;
    const cur = new Date(startDate);
    while (cur <= endDate) {
      if (isWorkingDay(cur)) {
        const fullyAbsent = isFullyAbsent(cur);
        count += fullyAbsent ? 1 : 0.5;

        // Regime "local" (voir Employee.IsExpatriate) : un vendredi
        // PLEINEMENT absent avale le week-end qui suit dans le decompte,
        // meme si la demande continue au-dela (reunion Dominique du 12/06 —
        // ex: conge vendredi->lundi = 3 jours pour un local, 1 seul pour un
        // expatrie). Une simple demi-journee de presence le vendredi
        // protege le week-end (voir isFullyAbsent). Verifie pour CHAQUE
        // vendredi de la periode, pas seulement le dernier jour — une
        // demande vendredi->mardi doit aussi avaler le week-end du milieu.
        if (!isExpatriate && cur.getDay() === 5 && fullyAbsent) {
          const cursor = new Date(cur);
          cursor.setDate(cursor.getDate() + 1);
          while (!isWorkingDay(cursor)) {
            count++;
            cursor.setDate(cursor.getDate() + 1);
          }
        }
      }
      cur.setDate(cur.getDate() + 1);
    }

    return count;
  }

  // Determine le validateur reel d'un membre de pool a une date donnee : le
  // titulaire, sauf s'il a une demande de conge Approuvee couvrant cette
  // date, auquel cas on route vers son interimaire declare — plus de plage
  // de dates saisie a la main sur l'interim, l'absence est detectee au
  // moment ou la demande arrive a ce niveau.
  private async resolveActualApprover(
    member: { EmployeeId: string; InterimEmployeeId: string | null },
    at: Date,
  ): Promise<string> {
    if (!member.InterimEmployeeId) return member.EmployeeId;
    const onApprovedLeave = await this.prisma.leaveRequest.findFirst({
      where: {
        EmployeeId: member.EmployeeId,
        Status: 'Approved',
        StartDate: { lte: at },
        EndDate: { gte: at },
        IsDeleted: false,
      },
    });
    return onApprovedLeave ? member.InterimEmployeeId : member.EmployeeId;
  }

  // Premier niveau (a partir de la liste triee fournie) dont le validateur
  // resolu n'est pas le demandeur lui-meme — un validateur ne doit jamais
  // rester bloque en attente de sa propre validation, que ce soit comme
  // titulaire ou comme interimaire du moment. undefined si tous les niveaux
  // restants resolvent au demandeur (approbation automatique complete).
  private async findApplicableStep<
    T extends { EmployeeId: string; InterimEmployeeId: string | null; StepOrder: number },
  >(sortedMembers: T[], requesterEmployeeId: string): Promise<{ member: T; approverId: string } | undefined> {
    for (const member of sortedMembers) {
      const approverId = await this.resolveActualApprover(member, new Date());
      if (approverId !== requesterEmployeeId) return { member, approverId };
    }
    return undefined;
  }

  // errorMessage personnalise le message selon le sujet controle (beneficiaire
  // vs interimaire, voir appels dans submit()) — la requete/logique reste
  // identique dans les deux cas, seul le libelle change.
  private async assertNoOverlap(
    employeeId: string,
    startDate: Date,
    endDate: Date,
    excludeId?: string,
    errorMessage?: (referenceCode: string) => string,
  ) {
    const overlapping = await this.prisma.leaveRequest.findFirst({
      where: {
        EmployeeId: employeeId,
        Status: { in: OVERLAPPING_STATUSES },
        Id: excludeId ? { not: excludeId } : undefined,
        StartDate: { lte: endDate },
        EndDate: { gte: startDate },
        IsDeleted: false,
      },
    });
    if (overlapping) {
      throw new BadRequestException(
        errorMessage
          ? errorMessage(overlapping.ReferenceCode)
          : `Cette période chevauche une demande existante (${overlapping.ReferenceCode})`,
      );
    }
  }

  // ── CRUD ─────────────────────────────────────────────────────────────

  // N'importe quel employe peut soumettre une demande pour n'importe quel
  // autre employe (decision du 01/08, aucune permission requise) — le
  // createur (CreatedBy) reste trace pour que lui et le beneficiaire (voir
  // findMine) gardent tous les deux la visibilite et la main sur la
  // demande (voir update/remove/submit/cancel ci-dessous).
  async create(dto: CreateLeaveRequestDto, requesterEmployeeId: string) {
    const employeeId = dto.EmployeeId ?? requesterEmployeeId;

    const employee = await this.prisma.employee.findUnique({ where: { Id: employeeId } });
    if (!employee) {
      throw new NotFoundException(`Employé ${employeeId} introuvable`);
    }

    const leaveType = await this.prisma.leaveType.findUnique({ where: { Id: dto.LeaveTypeId } });
    if (!leaveType) {
      throw new NotFoundException(`Type de congé ${dto.LeaveTypeId} introuvable`);
    }

    const startDate = new Date(dto.StartDate);
    const endDate = new Date(dto.EndDate);
    const startPeriod = dto.StartPeriod ?? 'full';
    const endPeriod = dto.EndPeriod ?? 'full';
    const daysCount = await this.computeWorkingDays(
      startDate, endDate, employee.OrganizationUnitId, employee.EmployeeCategoryId,
      employee.IsExpatriate, startPeriod, endPeriod,
    );
    if (daysCount <= 0) {
      throw new BadRequestException("La période sélectionnée ne contient aucun jour ouvré");
    }

    const referenceCode = await this.generateReferenceCode();

    return this.prisma.leaveRequest.create({
      data: {
        ReferenceCode: referenceCode,
        EmployeeId: employeeId,
        LeaveTypeId: dto.LeaveTypeId,
        StartDate: startDate,
        StartPeriod: startPeriod,
        EndDate: endDate,
        EndPeriod: endPeriod,
        DaysCount: daysCount,
        Reason: dto.Reason,
        InterimEmployeeId: dto.InterimEmployeeId,
        Status: 'Draft',
        CreatedBy: requesterEmployeeId,
      },
      include: LEAVE_REQUEST_INCLUDE,
    });
  }

  async update(id: string, dto: UpdateLeaveRequestDto, requesterEmployeeId: string, canActForOthers: boolean) {
    const existing = await this.findOneRaw(id);
    if (existing.EmployeeId !== requesterEmployeeId && existing.CreatedBy !== requesterEmployeeId && !canActForOthers) {
      throw new ForbiddenException("Vous ne pouvez modifier que vos propres demandes");
    }
    if (!EDITABLE_STATUSES.includes(existing.Status)) {
      throw new BadRequestException('Seule une demande en brouillon ou retournée peut être modifiée');
    }

    const leaveTypeId = dto.LeaveTypeId ?? existing.LeaveTypeId;
    const startDate = dto.StartDate ? new Date(dto.StartDate) : existing.StartDate;
    const endDate = dto.EndDate ? new Date(dto.EndDate) : existing.EndDate;
    const startPeriod = dto.StartPeriod ?? existing.StartPeriod;
    const endPeriod = dto.EndPeriod ?? existing.EndPeriod;

    let daysCount = existing.DaysCount;
    if (dto.StartDate || dto.EndDate || dto.StartPeriod || dto.EndPeriod) {
      const employee = await this.prisma.employee.findUniqueOrThrow({ where: { Id: existing.EmployeeId } });
      daysCount = await this.computeWorkingDays(
        startDate, endDate, employee.OrganizationUnitId, employee.EmployeeCategoryId,
        employee.IsExpatriate, startPeriod, endPeriod,
      ) as unknown as typeof existing.DaysCount;
    }

    return this.prisma.leaveRequest.update({
      where: { Id: id },
      data: {
        LeaveTypeId: leaveTypeId,
        StartDate: startDate,
        StartPeriod: startPeriod,
        EndDate: endDate,
        EndPeriod: endPeriod,
        DaysCount: daysCount,
        Reason: dto.Reason,
        InterimEmployeeId: dto.InterimEmployeeId,
        ModifiedBy: requesterEmployeeId,
        ModifiedAt: new Date(),
      },
      include: LEAVE_REQUEST_INCLUDE,
    });
  }

  async remove(id: string, requesterEmployeeId: string, canActForOthers: boolean) {
    const existing = await this.findOneRaw(id);
    if (existing.EmployeeId !== requesterEmployeeId && existing.CreatedBy !== requesterEmployeeId && !canActForOthers) {
      throw new ForbiddenException("Vous ne pouvez supprimer que vos propres demandes");
    }
    if (existing.Status !== 'Draft') {
      throw new BadRequestException('Seule une demande en brouillon peut être supprimée');
    }
    return this.prisma.leaveRequest.delete({ where: { Id: id } });
  }

  // Suppression definitive (Lot I) — distincte de remove() ci-dessus (hard
  // delete, reserve aux brouillons). Ici, n'importe quelle demande (quel que
  // soit son statut) peut etre cachee de tout l'app (IsDeleted=true) sans
  // toucher a l'historique des soldes/notifications qui pointent vers son
  // Id — reversible uniquement en base par un dev.
  // Une demande approuvee (ou tout statut derive : Registered/Done/
  // Regularized) ne doit plus jamais pouvoir disparaitre — c'est la trace
  // qui justifie le solde de conges consomme et l'historique RH. InApprovalN2+
  // est inclus aussi : y arriver implique qu'un validateur (N1 au minimum) a
  // deja approuve une etape, sa decision ne doit pas pouvoir etre effacee
  // sous lui (decision du 12/08). Seules les demandes jamais approuvees par
  // personne (brouillon, en attente du tout premier validateur, refusee,
  // retournee, annulee) restent supprimables definitivement.
  private static readonly APPROVED_LINEAGE = [
    'Approved', 'Registered', 'Done', 'Regularized',
    'InApprovalN2', 'InApprovalN3', 'InApprovalN4',
  ];

  async softDelete(id: string, deletedBy: string) {
    const existing = await this.findOneRaw(id);
    if (LeaveRequestService.APPROVED_LINEAGE.includes(existing.Status)) {
      throw new BadRequestException('Une demande approuvée ne peut plus être supprimée.');
    }
    const leaveRequest = await this.prisma.leaveRequest.update({
      where: { Id: id },
      data: { IsDeleted: true, DeletedBy: deletedBy, DeletedAt: new Date() },
    });
    this.realtime.broadcastCompany('data:changed', { domain: 'leave' });
    return leaveRequest;
  }

  private async findOneRaw(id: string) {
    // include leaveType : sans ça toContext() (emails/notifications) ne
    // peut jamais afficher le type de congé, il retombe systematiquement
    // sur le fallback '—'.
    const leaveRequest = await this.prisma.leaveRequest.findUnique({ where: { Id: id }, include: { leaveType: true } });
    if (!leaveRequest || leaveRequest.IsDeleted) {
      throw new NotFoundException(`Demande de congé ${id} introuvable`);
    }
    return leaveRequest;
  }

  async findOne(id: string) {
    const leaveRequest = await this.prisma.leaveRequest.findUnique({
      where: { Id: id },
      include: {
        employee: { select: { Id: true, FullName: true, EmployeeNumber: true, OrganizationUnitId: true } },
        leaveType: true,
        interimEmployee: { select: { Id: true, FullName: true } },
        createdByEmployee: { select: { Id: true, FullName: true } },
      },
    });
    if (!leaveRequest || leaveRequest.IsDeleted) {
      throw new NotFoundException(`Demande de congé ${id} introuvable`);
    }
    const decisions = await this.prisma.approvalDecision.findMany({
      where: { EntityType: 'LeaveRequest', EntityId: id },
      orderBy: { StepOrder: 'asc' },
      include: { validatedByEmployee: { select: { Id: true, FullName: true } } },
    });
    const withBalance = await this.attachBalanceFlag(leaveRequest);
    return { ...withBalance, decisions };
  }

  // "Mes demandes" inclut aussi les demandes que j'ai creees pour un autre
  // employe (decision du 01/08, n'importe qui peut soumettre pour n'importe
  // qui) — le createur doit pouvoir suivre ce qu'il a soumis, pas seulement
  // le beneficiaire.
  async findMine(employeeId: string) {
    const requests = await this.prisma.leaveRequest.findMany({
      where: { OR: [{ EmployeeId: employeeId }, { CreatedBy: employeeId }], IsDeleted: false },
      include: {
        leaveType: true,
        employee: { select: { Id: true, FullName: true, EmployeeNumber: true } },
        createdByEmployee: { select: { Id: true, FullName: true } },
      },
      orderBy: { CreatedAt: 'desc' },
    });
    return this.attachBalanceFlags(requests);
  }

  async findTeam(managerEmployeeId: string) {
    const unitIds = await this.collectManagedUnitIds(managerEmployeeId);
    if (unitIds.length === 0) return [];
    const requests = await this.prisma.leaveRequest.findMany({
      where: { employee: { OrganizationUnitId: { in: unitIds } }, IsDeleted: false },
      include: LEAVE_REQUEST_INCLUDE,
      orderBy: { CreatedAt: 'desc' },
    });
    return this.attachBalanceFlags(requests);
  }

  // Unites "geree" par un employe : celles dont il est le Responsable
  // designe, mais aussi celles ou il siege comme validateur d'un pool de
  // conges — un validateur doit garder une visibilite sur les demandes de
  // cette equipe meme une fois qu'elles remontent au-dela de son niveau.
  private async collectManagedUnitIds(managerEmployeeId: string): Promise<string[]> {
    const [managedRoots, validatorPools] = await Promise.all([
      this.prisma.organizationUnit.findMany({
        where: { ManagerId: managerEmployeeId },
        select: { Id: true },
      }),
      this.prisma.approvalPool.findMany({
        where: { ObjectType: 'Leave', members: { some: { EmployeeId: managerEmployeeId } } },
        select: { OrganizationUnitId: true },
      }),
    ]);
    const roots = new Set<string>([
      ...managedRoots.map((unit) => unit.Id),
      ...validatorPools.map((pool) => pool.OrganizationUnitId),
    ]);
    const collected: string[] = [];
    const queue = [...roots];
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

  async findAll() {
    const requests = await this.prisma.leaveRequest.findMany({
      where: { IsDeleted: false },
      include: LEAVE_REQUEST_INCLUDE,
      orderBy: { CreatedAt: 'desc' },
    });
    return this.attachBalanceFlags(requests);
  }

  async findPendingForMe(employeeId: string) {
    const inApproval = await this.prisma.leaveRequest.findMany({
      where: { Status: { in: ['InApprovalN1', 'InApprovalN2', 'InApprovalN3', 'InApprovalN4'] }, IsDeleted: false },
      include: {
        employee: { select: { Id: true, FullName: true, EmployeeNumber: true } },
        createdByEmployee: { select: { Id: true, FullName: true } },
        leaveType: true,
      },
      orderBy: { CreatedAt: 'asc' },
    });
    const now = new Date();
    const result: typeof inApproval = [];
    for (const lr of inApproval) {
      const member = await this.prisma.approvalPoolMember.findFirst({
        where: { ApprovalPoolId: lr.ApprovalPoolId as string, StepOrder: lr.CurrentApprovalStep as number },
      });
      if (member && (await this.resolveActualApprover(member, now)) === employeeId) {
        result.push(lr);
      }
    }
    return this.attachBalanceFlags(result);
  }

  // Demandes deja decidees par ce validateur (approuve/refuse/retourne), peu
  // importe leur statut actuel — un validateur doit garder une trace
  // permanente de ce qu'il a traite dans "à valider", pas seulement ce qui
  // attend encore une action de sa part (voir findPendingForMe, qui lui
  // reste volontairement limite aux etapes en cours pour que le badge de
  // notification reste exact).
  async findValidatedByMe(employeeId: string) {
    const decisions = await this.prisma.approvalDecision.findMany({
      where: { EntityType: 'LeaveRequest', ValidatedByEmployeeId: employeeId, Decision: { not: 'Pending' } },
      select: { EntityId: true },
    });
    const requestIds = [...new Set(decisions.map((d) => d.EntityId))];
    if (requestIds.length === 0) return [];
    const requests = await this.prisma.leaveRequest.findMany({
      where: { Id: { in: requestIds }, IsDeleted: false },
      include: LEAVE_REQUEST_INCLUDE,
      orderBy: { ModifiedAt: 'desc' },
    });
    return this.attachBalanceFlags(requests);
  }

  // ── Workflow ─────────────────────────────────────────────────────────

  async submit(id: string, requesterEmployeeId: string, canActForOthers: boolean) {
    const existing = await this.findOneRaw(id);
    if (existing.EmployeeId !== requesterEmployeeId && existing.CreatedBy !== requesterEmployeeId && !canActForOthers) {
      throw new ForbiddenException("Vous ne pouvez soumettre que vos propres demandes");
    }
    if (!EDITABLE_STATUSES.includes(existing.Status)) {
      throw new BadRequestException('Seule une demande en brouillon ou retournée peut être soumise');
    }

    const employee = await this.prisma.employee.findUniqueOrThrow({ where: { Id: existing.EmployeeId } });
    const leaveType = await this.prisma.leaveType.findUniqueOrThrow({ where: { Id: existing.LeaveTypeId } });

    await this.assertNoOverlap(existing.EmployeeId, existing.StartDate, existing.EndDate, existing.Id);

    // L'interimaire designe doit etre lui-meme disponible sur la periode —
    // sinon il ne peut pas reellement assurer le remplacement (Lot H #7).
    if (existing.InterimEmployeeId) {
      await this.assertNoOverlap(
        existing.InterimEmployeeId, existing.StartDate, existing.EndDate, undefined,
        (code) => `L'intérimaire désigné est lui-même absent sur cette période (${code}) — choisissez quelqu'un d'autre ou ajustez les dates`,
      );
    }

    if (leaveType.WorkflowType === 'Medical') {
      return this.registerMedicalLeave(existing, leaveType, requesterEmployeeId);
    }
    return this.routeToApproval(existing, employee, leaveType, requesterEmployeeId);
  }

  // Solde insuffisant n'est pas bloquant ici non plus (decision du 12/08,
  // meme traitement que routeToApproval) — la declaration est quand meme
  // enregistree, le front affiche l'avertissement en rouge. La consommation
  // reste plafonnee a 0 par adjustBalance (jamais de solde negatif en base).
  private async registerMedicalLeave(
    leaveRequest: Awaited<ReturnType<LeaveRequestService['findOneRaw']>>,
    leaveType: { Id: string; DaysPerYear: unknown },
    requesterEmployeeId: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.leaveRequest.update({
        where: { Id: leaveRequest.Id },
        data: { Status: 'Registered', ModifiedBy: requesterEmployeeId, ModifiedAt: new Date() },
        include: LEAVE_REQUEST_INCLUDE,
      });
      await this.leaveTransactionService.adjustBalance(
        leaveRequest.EmployeeId,
        leaveRequest.LeaveTypeId,
        Number(leaveRequest.DaysCount),
        'Consumption',
        requesterEmployeeId,
        leaveRequest.Id,
        tx,
      );
      return updated;
    });
  }

  private async routeToApproval(
    leaveRequest: Awaited<ReturnType<LeaveRequestService['findOneRaw']>>,
    employee: { OrganizationUnitId: string },
    leaveType: { Id: string; DaysPerYear: unknown; MinNoticeDays: number },
    requesterEmployeeId: string,
  ) {
    // Le préavis minimum n'est plus bloquant (decision du 01/08) — une
    // demande soumise trop tard reste soumise normalement, le validateur
    // voit l'avertissement (calculé côté front à partir de StartDate/
    // CreatedAt/MinNoticeDays) et décide en connaissance de cause.

    // Le solde insuffisant n'est plus bloquant non plus (decision du 04/08,
    // meme traitement que le preavis) — la demande est quand meme soumise,
    // le front affiche l'avertissement en rouge et le validateur decide en
    // connaissance de cause. La consommation reste plafonnee a 0 par
    // adjustBalance (jamais de solde negatif en base), voir approve().

    const pool = await this.approvalPoolService.findApplicablePool(employee.OrganizationUnitId, 'Leave');
    if (!pool) {
      throw new NotFoundException(
        "Aucun pool de validation de congé n'est configuré pour cette unité ou ses parents — contactez le RH",
      );
    }
    const sortedMembers = pool.members.slice().sort((a, b) => a.StepOrder - b.StepOrder);
    if (sortedMembers.length === 0) {
      throw new NotFoundException('Le pool de validation applicable ne contient aucun validateur');
    }

    // Si le beneficiaire (pas forcement celui qui soumet — voir decision du
    // 01/08, n'importe qui peut creer/soumettre pour n'importe qui) occupe
    // lui-meme un niveau de validateur dans ce pool, ce niveau ET tous les
    // niveaux en dessous sont consideres deja acquis — un validateur senior
    // n'a pas besoin qu'un validateur junior de la meme entite re-valide sa
    // demande, meme si c'est son assistant qui a rempli le formulaire pour
    // lui. Seuls les niveaux strictement au-dessus de sa propre position
    // restent a valider (findApplicableStep gere en plus le cas, rare, ou
    // le beneficiaire est aussi l'interimaire resolu d'un de ces niveaux
    // superieurs).
    const beneficiaryEmployeeId = leaveRequest.EmployeeId;
    const beneficiaryOwnLevel = Math.max(
      0,
      ...sortedMembers.filter((m) => m.EmployeeId === beneficiaryEmployeeId).map((m) => m.StepOrder),
    );
    const candidateMembers = sortedMembers.filter((m) => m.StepOrder > beneficiaryOwnLevel);
    const applicable = await this.findApplicableStep(candidateMembers, beneficiaryEmployeeId);
    if (!applicable) {
      const updated = await this.prisma.$transaction(async (tx) => {
        const updated = await tx.leaveRequest.update({
          where: { Id: leaveRequest.Id },
          data: {
            Status: 'Approved', ApprovalPoolId: pool.Id, RejectionReason: null,
            ModifiedBy: requesterEmployeeId, ModifiedAt: new Date(),
          },
          include: LEAVE_REQUEST_INCLUDE,
        });
        await this.leaveTransactionService.adjustBalance(
          leaveRequest.EmployeeId, leaveType.Id, Number(leaveRequest.DaysCount),
          'Consumption', requesterEmployeeId, leaveRequest.Id, tx,
        );
        return updated;
      });
      await this.notifier.notifyApproved(this.toContext(leaveRequest), { autoApproved: true });
      return updated;
    }

    const { member: firstStep, approverId } = applicable;
    const token = generateApprovalToken();
    const updated = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.leaveRequest.update({
        where: { Id: leaveRequest.Id },
        data: {
          Status: `InApprovalN${firstStep.StepOrder}`,
          ApprovalPoolId: pool.Id,
          CurrentApprovalStep: firstStep.StepOrder,
          RejectionReason: null,
          ModifiedBy: requesterEmployeeId,
          ModifiedAt: new Date(),
        },
        include: LEAVE_REQUEST_INCLUDE,
      });
      await tx.approvalDecision.create({
        data: {
          EntityType: 'LeaveRequest',
          EntityId: leaveRequest.Id,
          ApprovalPoolMemberId: firstStep.Id,
          ValidatedByEmployeeId: approverId,
          StepOrder: firstStep.StepOrder,
          Decision: 'Pending',
          CreatedBy: requesterEmployeeId,
          Token: token,
        },
      });
      return updated;
    });
    await this.notifier.notifySubmitted(this.toContext(leaveRequest), approverId, token);
    return updated;
  }

  private async assertIsCurrentApprover(
    leaveRequest: Awaited<ReturnType<LeaveRequestService['findOneRaw']>>,
    approverEmployeeId: string,
    canOverride: boolean,
  ) {
    if (canOverride) return;
    if (!leaveRequest.ApprovalPoolId || leaveRequest.CurrentApprovalStep == null) {
      throw new ForbiddenException("Cette demande n'est pas en attente de validation");
    }
    const member = await this.prisma.approvalPoolMember.findFirst({
      where: { ApprovalPoolId: leaveRequest.ApprovalPoolId, StepOrder: leaveRequest.CurrentApprovalStep },
    });
    if (!member || (await this.resolveActualApprover(member, new Date())) !== approverEmployeeId) {
      throw new ForbiddenException("Vous n'êtes pas le validateur actuel de cette demande");
    }
  }

  async approve(id: string, dto: DecideLeaveRequestDto, approverEmployeeId: string, canOverride: boolean) {
    const existing = await this.findOneRaw(id);
    await this.assertIsCurrentApprover(existing, approverEmployeeId, canOverride);

    const pendingDecision = await this.prisma.approvalDecision.findFirst({
      where: {
        EntityType: 'LeaveRequest',
        EntityId: id,
        StepOrder: existing.CurrentApprovalStep as number,
        Decision: 'Pending',
      },
    });
    if (!pendingDecision) {
      throw new BadRequestException("Aucune décision en attente pour cette étape");
    }

    const pool = await this.prisma.approvalPool.findUniqueOrThrow({
      where: { Id: existing.ApprovalPoolId as string },
      include: { members: true },
    });
    // Le demandeur original (pas l'approbateur courant) est la referance a
    // eviter — si les niveaux restants resolvent tous a lui, la demande
    // passe directement en Approuve plutot que de rester bloquee.
    const remainingMembers = pool.members
      .filter((m) => m.StepOrder > (existing.CurrentApprovalStep as number))
      .sort((a, b) => a.StepOrder - b.StepOrder);
    const applicable = await this.findApplicableStep(remainingMembers, existing.EmployeeId);
    const nextToken = applicable ? generateApprovalToken() : null;

    const result = await this.prisma.$transaction(async (tx) => {
      await tx.approvalDecision.update({
        where: { Id: pendingDecision.Id },
        data: {
          Decision: 'Approved',
          Comment: dto.Comment,
          DecidedAt: new Date(),
          ValidatedByEmployeeId: approverEmployeeId,
        },
      });

      if (applicable) {
        const { member: nextStep, approverId } = applicable;
        const updated = await tx.leaveRequest.update({
          where: { Id: id },
          data: { Status: `InApprovalN${nextStep.StepOrder}`, CurrentApprovalStep: nextStep.StepOrder },
          include: LEAVE_REQUEST_INCLUDE,
        });
        await tx.approvalDecision.create({
          data: {
            EntityType: 'LeaveRequest',
            EntityId: id,
            ApprovalPoolMemberId: nextStep.Id,
            ValidatedByEmployeeId: approverId,
            StepOrder: nextStep.StepOrder,
            Decision: 'Pending',
            CreatedBy: approverEmployeeId,
            Token: nextToken,
          },
        });
        return { updated, nextApproverId: approverId as string | null };
      }

      const updated = await tx.leaveRequest.update({
        where: { Id: id },
        data: { Status: 'Approved' },
        include: LEAVE_REQUEST_INCLUDE,
      });
      await this.leaveTransactionService.adjustBalance(
        existing.EmployeeId,
        existing.LeaveTypeId,
        Number(existing.DaysCount),
        'Consumption',
        approverEmployeeId,
        existing.Id,
        tx,
      );
      return { updated, nextApproverId: null };
    });

    if (result.nextApproverId) {
      await this.notifier.notifyProgressed(this.toContext(existing), result.nextApproverId, nextToken as string);
    } else {
      await this.notifier.notifyApproved(this.toContext(existing), { autoApproved: false });
    }
    return result.updated;
  }

  async reject(id: string, dto: DecideLeaveRequestDto, approverEmployeeId: string, canOverride: boolean) {
    if (!dto.Comment || dto.Comment.trim().length === 0) {
      throw new BadRequestException('Le motif du refus est requis');
    }
    const existing = await this.findOneRaw(id);
    await this.assertIsCurrentApprover(existing, approverEmployeeId, canOverride);
    const updated = await this.closeApprovalStep(existing, 'Rejected', dto.Comment, approverEmployeeId);
    await this.notifier.notifyRejected(this.toContext(existing), dto.Comment);
    return updated;
  }

  async return_(id: string, dto: DecideLeaveRequestDto, approverEmployeeId: string, canOverride: boolean) {
    if (!dto.Comment || dto.Comment.trim().length === 0) {
      throw new BadRequestException('Le commentaire est requis');
    }
    const existing = await this.findOneRaw(id);
    await this.assertIsCurrentApprover(existing, approverEmployeeId, canOverride);
    const updated = await this.closeApprovalStep(existing, 'Returned', dto.Comment, approverEmployeeId);
    await this.notifier.notifyReturned(this.toContext(existing), dto.Comment);
    return updated;
  }

  private async closeApprovalStep(
    existing: Awaited<ReturnType<LeaveRequestService['findOneRaw']>>,
    decision: 'Rejected' | 'Returned',
    comment: string,
    approverEmployeeId: string,
  ) {
    const pendingDecision = await this.prisma.approvalDecision.findFirst({
      where: {
        EntityType: 'LeaveRequest',
        EntityId: existing.Id,
        StepOrder: existing.CurrentApprovalStep as number,
        Decision: 'Pending',
      },
    });

    return this.prisma.$transaction(async (tx) => {
      if (pendingDecision) {
        await tx.approvalDecision.update({
          where: { Id: pendingDecision.Id },
          data: { Decision: decision, Comment: comment, DecidedAt: new Date(), ValidatedByEmployeeId: approverEmployeeId },
        });
      }
      return tx.leaveRequest.update({
        where: { Id: existing.Id },
        data: { Status: decision, RejectionReason: comment },
        include: LEAVE_REQUEST_INCLUDE,
      });
    });
  }

  async cancel(id: string, requesterEmployeeId: string, canOverride: boolean) {
    const existing = await this.findOneRaw(id);
    const isSelf = existing.EmployeeId === requesterEmployeeId || existing.CreatedBy === requesterEmployeeId;
    if (!isSelf && !canOverride) {
      throw new ForbiddenException("Vous ne pouvez annuler que vos propres demandes");
    }
    // Une fois approuvee (ou enregistree directement, cas conge medical), le
    // demandeur ne peut plus annuler lui-meme sa propre demande — seule une
    // action administrative (canOverride, sur la demande d'un tiers) le peut
    // encore, par ex. pour corriger une erreur.
    const SELF_CANCELLABLE = ['Draft', 'Pending', 'InApprovalN1', 'InApprovalN2', 'InApprovalN3', 'InApprovalN4'];
    const cancellable = isSelf ? SELF_CANCELLABLE : [...SELF_CANCELLABLE, 'Approved', 'Registered'];
    if (!cancellable.includes(existing.Status)) {
      throw new BadRequestException(`Une demande au statut "${existing.Status}" ne peut plus être annulée`);
    }

    const balanceWasDebited = existing.Status === 'Approved' || existing.Status === 'Registered';

    const updated = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.leaveRequest.update({
        where: { Id: id },
        data: { Status: 'Cancelled', ModifiedBy: requesterEmployeeId, ModifiedAt: new Date() },
        include: LEAVE_REQUEST_INCLUDE,
      });
      if (balanceWasDebited) {
        await this.leaveTransactionService.adjustBalance(
          existing.EmployeeId,
          existing.LeaveTypeId,
          Number(existing.DaysCount),
          'Acquisition',
          requesterEmployeeId,
          existing.Id,
          tx,
        );
      }
      return updated;
    });
    await this.notifier.notifyCancelled(this.toContext(existing), requesterEmployeeId);
    return updated;
  }

  async markDone(id: string, requesterEmployeeId: string) {
    const existing = await this.findOneRaw(id);
    if (existing.EmployeeId !== requesterEmployeeId && existing.CreatedBy !== requesterEmployeeId) {
      throw new ForbiddenException("Vous ne pouvez mettre à jour que vos propres demandes");
    }
    if (existing.Status !== 'Registered') {
      throw new BadRequestException('Seule une demande enregistrée peut être marquée comme effectuée');
    }
    return this.prisma.leaveRequest.update({
      where: { Id: id },
      data: { Status: 'Done', ModifiedBy: requesterEmployeeId, ModifiedAt: new Date() },
      include: LEAVE_REQUEST_INCLUDE,
    });
  }

  async regularize(id: string, requesterEmployeeId: string) {
    const existing = await this.findOneRaw(id);
    if (existing.EmployeeId !== requesterEmployeeId && existing.CreatedBy !== requesterEmployeeId) {
      throw new ForbiddenException("Vous ne pouvez mettre à jour que vos propres demandes");
    }
    if (existing.Status !== 'Done') {
      throw new BadRequestException('Seule une demande effectuée peut être régularisée');
    }
    const updated = await this.prisma.leaveRequest.update({
      where: { Id: id },
      data: { Status: 'Regularized', ModifiedBy: requesterEmployeeId, ModifiedAt: new Date() },
      include: LEAVE_REQUEST_INCLUDE,
    });
    await this.notifier.notifyRegularized(this.toContext(existing));
    return updated;
  }
}

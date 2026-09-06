import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../../../prisma/generated/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ApprovalPoolService } from '../approval-pool/approval-pool.service';
import { WorkflowNotifierService, WorkflowContext } from '../notification/workflow-notifier.service';
import { formatDateFr } from '../mail/email-templates';
import { generateApprovalToken } from '../../common/approval-token';
import { CreateMissionOrderDto } from './dto/create-mission-order.dto';
import { UpdateMissionOrderDto } from './dto/update-mission-order.dto';
import { DecideMissionOrderDto } from './dto/decide-mission-order.dto';
import { RealtimeGateway } from '../realtime/realtime.gateway';

const EDITABLE_STATUSES = ['Draft', 'Returned'];
const CANCELLABLE_STATUSES = ['Draft', 'InApprovalN1', 'InApprovalN2', 'InApprovalN3', 'InApprovalN4', 'Approved'];
const DEFAULT_CURRENCY = 'MGA';

type TxClient = Prisma.TransactionClient | PrismaService;

// Applique a chaque create/update mutant un ordre de mission — sans ça la
// reponse renvoyee par l'endpoint (utilisee par le front pour patcher sa
// liste en place) n'a pas employee et la ligne s'affiche avec un nom et des
// initiales vides jusqu'au prochain rechargement complet.
const MISSION_EMPLOYEE_INCLUDE = {
  employee: { select: { Id: true, FullName: true, EmployeeNumber: true } },
  createdByEmployee: { select: { Id: true, FullName: true } },
  missionExpenseLines: { include: { expenseType: true } },
  // Mission accompagnant (plan de test #22) — voir doc-comment du champ
  // LinkedMissionOrderId dans schema.prisma.
  linkedMissionOrder: {
    select: {
      Id: true, ReferenceCode: true, Destination: true, Status: true,
      employee: { select: { Id: true, FullName: true } },
    },
  },
} as const;

export interface AllowanceLine {
  expenseTypeId: string;
  expenseTypeName: string;
  unit: string;
  rate: number;
  days: number;
  amount: number;
  currency: string;
  documentRequired: boolean;
}

@Injectable()
export class MissionOrderService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly approvalPoolService: ApprovalPoolService,
    private readonly notifier: WorkflowNotifierService,
    private readonly realtime: RealtimeGateway,
  ) {}

  // ── Helpers ──────────────────────────────────────────────────────────

  private toContext(mo: {
    Id: string; ReferenceCode: string; EmployeeId: string; CreatedBy: string;
    Destination: string; DepartureDate: Date; ReturnDate: Date; DaysCount: unknown;
  }): WorkflowContext {
    return {
      kind: 'mission',
      id: mo.Id,
      referenceCode: mo.ReferenceCode,
      beneficiaryId: mo.EmployeeId,
      creatorId: mo.CreatedBy,
      summary: mo.Destination,
      details: [
        { label: 'Destination', value: mo.Destination },
        { label: 'Départ', value: formatDateFr(mo.DepartureDate) },
        { label: 'Retour', value: formatDateFr(mo.ReturnDate) },
        { label: 'Durée', value: `${Number(mo.DaysCount)} jour(s)` },
      ],
    };
  }

  private async generateReferenceCode(client: TxClient = this.prisma): Promise<string> {
    const year = new Date().getFullYear();
    const prefix = `OM-${year}-`;
    const count = await client.missionOrder.count({
      where: { ReferenceCode: { startsWith: prefix } },
    });
    return `${prefix}${String(count + 1).padStart(5, '0')}`;
  }

  // DepartureDate/ReturnDate sont des dates pures (sans heure) — duree
  // inclusive : depart et retour le meme jour = 1 jour.
  private computeDays(departureDate: Date, returnDate: Date): number {
    if (returnDate < departureDate) {
      throw new BadRequestException('La date de retour doit être postérieure ou égale à la date de départ');
    }
    const diffDays = Math.round((returnDate.getTime() - departureDate.getTime()) / 86400000);
    return diffDays + 1;
  }

  // Calcule l'estimation du per diem a partir de la matrice ExpenseConfig —
  // aucun montant n'est stocke sur MissionOrder, tout est recalcule a la
  // volee (voir doc-comment du modele dans schema.prisma).
  private async computeAllowanceEstimate(
    employeeCategoryId: string | null,
    missionCategory: string,
    days: number,
  ): Promise<{ lines: AllowanceLine[]; total: number }> {
    if (!employeeCategoryId) {
      return { lines: [], total: 0 };
    }
    const configs = await this.prisma.expenseConfig.findMany({
      where: { EmployeeCategoryId: employeeCategoryId, MissionCategory: missionCategory, IsActive: true },
      include: { expenseType: true },
    });
    const lines: AllowanceLine[] = configs.map((c) => {
      const rate = Number(c.DailyRate);
      const amount = c.expenseType.Unit === 'PerDay' ? rate * days : c.expenseType.Unit === 'PerTrip' ? rate : 0;
      return {
        expenseTypeId: c.ExpenseTypeId,
        expenseTypeName: c.expenseType.Name,
        unit: c.expenseType.Unit,
        rate,
        days,
        amount,
        currency: c.Currency,
        documentRequired: c.DocumentRequired,
      };
    });
    return { lines, total: lines.reduce((s, l) => s + l.amount, 0) };
  }

  // Attache un total estime a chaque mission d'une liste, en groupant les
  // requetes ExpenseConfig/Employee (2 requetes au total, pas de N+1).
  private async attachEstimatedTotals<T extends { EmployeeId: string; MissionCategory: string; DaysCount: unknown }>(
    missions: T[],
  ): Promise<(T & { EstimatedTotal: number })[]> {
    if (missions.length === 0) return [];
    const employeeIds = [...new Set(missions.map((m) => m.EmployeeId))];
    const employees = await this.prisma.employee.findMany({
      where: { Id: { in: employeeIds } },
      select: { Id: true, EmployeeCategoryId: true },
    });
    const categoryByEmployee = new Map(employees.map((e) => [e.Id, e.EmployeeCategoryId]));

    const categoryIds = [...new Set(employees.map((e) => e.EmployeeCategoryId).filter((id): id is string => !!id))];
    const configs = categoryIds.length
      ? await this.prisma.expenseConfig.findMany({
          where: { EmployeeCategoryId: { in: categoryIds }, IsActive: true },
          include: { expenseType: true },
        })
      : [];

    return missions.map((m) => {
      const categoryId = categoryByEmployee.get(m.EmployeeId) ?? null;
      const days = Number(m.DaysCount);
      const total = configs
        .filter((c) => c.EmployeeCategoryId === categoryId && c.MissionCategory === m.MissionCategory)
        .reduce((s, c) => {
          const rate = Number(c.DailyRate);
          const amount = c.expenseType.Unit === 'PerDay' ? rate * days : c.expenseType.Unit === 'PerTrip' ? rate : 0;
          return s + amount;
        }, 0);
      return { ...m, EstimatedTotal: total };
    });
  }

  private async findOneRaw(id: string) {
    const missionOrder = await this.prisma.missionOrder.findUnique({ where: { Id: id } });
    if (!missionOrder || missionOrder.IsDeleted) {
      throw new NotFoundException(`Ordre de mission ${id} introuvable`);
    }
    return missionOrder;
  }

  // Voir LeaveRequestService.resolveActualApprover — meme logique, dupliquee
  // faute de base commune entre les 3 modules de workflow d'approbation.
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

  private async findApplicableStep<
    T extends { EmployeeId: string; InterimEmployeeId: string | null; StepOrder: number },
  >(sortedMembers: T[], requesterEmployeeId: string): Promise<{ member: T; approverId: string } | undefined> {
    for (const member of sortedMembers) {
      const approverId = await this.resolveActualApprover(member, new Date());
      if (approverId !== requesterEmployeeId) return { member, approverId };
    }
    return undefined;
  }

  // ── Estimation (calculette live du formulaire de creation) ───────────

  async estimate(employeeId: string, missionCategory: string, departureDate: string, returnDate: string) {
    const employee = await this.prisma.employee.findUnique({ where: { Id: employeeId } });
    if (!employee) {
      throw new NotFoundException(`Employé ${employeeId} introuvable`);
    }
    const days = this.computeDays(new Date(departureDate), new Date(returnDate));
    const result = await this.computeAllowanceEstimate(employee.EmployeeCategoryId, missionCategory, days);
    return { days, ...result };
  }

  // ── CRUD ─────────────────────────────────────────────────────────────

  // N'importe quel employe peut creer un ordre de mission pour n'importe
  // quel autre employe (decision du 01/08, aucune permission requise) — le
  // createur (CreatedBy) reste trace pour que lui et le beneficiaire (voir
  // findMine) gardent tous les deux la visibilite et la main sur l'ordre.
  async create(dto: CreateMissionOrderDto, requesterEmployeeId: string) {
    const employeeId = dto.EmployeeId ?? requesterEmployeeId;

    const employee = await this.prisma.employee.findUnique({ where: { Id: employeeId } });
    if (!employee) {
      throw new NotFoundException(`Employé ${employeeId} introuvable`);
    }
    if (!employee.EmployeeCategoryId) {
      throw new BadRequestException(
        "Cet employé n'a pas de catégorie de frais assignée — contactez le RH avant de créer un ordre de mission",
      );
    }

    // Mission accompagnant (plan de test #22) — verifie l'existence de
    // l'associe avant toute ecriture.
    if (dto.AssociatedEmployeeId) {
      if (dto.AssociatedEmployeeId === employeeId) {
        throw new BadRequestException("L'accompagnant doit être différent du titulaire de la mission");
      }
      const associatedExists = await this.prisma.employee.findUnique({ where: { Id: dto.AssociatedEmployeeId } });
      if (!associatedExists) {
        throw new NotFoundException(`Employé ${dto.AssociatedEmployeeId} introuvable`);
      }
    }

    const departureDate = new Date(dto.DepartureDate);
    const returnDate = new Date(dto.ReturnDate);
    const daysCount = this.computeDays(departureDate, returnDate);

    const baseData = {
      Destination: dto.Destination,
      MissionCategory: dto.MissionCategory,
      Purpose: dto.Purpose,
      DepartureDate: departureDate,
      ReturnDate: returnDate,
      DaysCount: daysCount,
      TransportModeGo: dto.TransportModeGo,
      TransportModeReturn: dto.TransportModeReturn,
      Currency: dto.Currency ?? DEFAULT_CURRENCY,
      Status: 'Draft',
      CreatedBy: requesterEmployeeId,
    };

    if (!dto.AssociatedEmployeeId) {
      const referenceCode = await this.generateReferenceCode();
      return this.prisma.missionOrder.create({
        data: {
          ...baseData,
          ReferenceCode: referenceCode,
          EmployeeId: employeeId,
          AdvanceRequested: dto.AdvanceRequested ?? 0,
          missionExpenseLines: dto.ExpenseLines?.length
            ? {
                create: dto.ExpenseLines.map((l) => ({
                  ExpenseTypeId: l.ExpenseTypeId,
                  Description: l.Description,
                  Amount: l.Amount,
                  CreatedBy: requesterEmployeeId,
                })),
              }
            : undefined,
        },
        include: MISSION_EMPLOYEE_INCLUDE,
      });
    }

    // Cree les deux ordres (titulaire + accompagnant) et les lie
    // symetriquement en une seule transaction — chacun suit ensuite son
    // propre workflow d'approbation independant (voir cascade dans submit()).
    const { primaryId, associateId } = await this.prisma.$transaction(async (tx) => {
      const primaryCode = await this.generateReferenceCode(tx);
      const primary = await tx.missionOrder.create({
        data: {
          ...baseData,
          ReferenceCode: primaryCode,
          EmployeeId: employeeId,
          AdvanceRequested: dto.AdvanceRequested ?? 0,
          missionExpenseLines: dto.ExpenseLines?.length
            ? {
                create: dto.ExpenseLines.map((l) => ({
                  ExpenseTypeId: l.ExpenseTypeId,
                  Description: l.Description,
                  Amount: l.Amount,
                  CreatedBy: requesterEmployeeId,
                })),
              }
            : undefined,
        },
      });
      const associateCode = await this.generateReferenceCode(tx);
      const associate = await tx.missionOrder.create({
        data: {
          ...baseData,
          ReferenceCode: associateCode,
          EmployeeId: dto.AssociatedEmployeeId as string,
          AdvanceRequested: 0,
        },
      });
      await tx.missionOrder.update({ where: { Id: primary.Id }, data: { LinkedMissionOrderId: associate.Id } });
      await tx.missionOrder.update({ where: { Id: associate.Id }, data: { LinkedMissionOrderId: primary.Id } });
      return { primaryId: primary.Id, associateId: associate.Id };
    });

    // Email a l'accompagnant en dehors de la transaction (best-effort) : un
    // echec d'envoi ne doit pas faire echouer la creation, deja actee en
    // base.
    const associateCtx = this.toContext({
      Id: associateId,
      ReferenceCode: '',
      EmployeeId: dto.AssociatedEmployeeId as string,
      CreatedBy: requesterEmployeeId,
      Destination: dto.Destination,
      DepartureDate: departureDate,
      ReturnDate: returnDate,
      DaysCount: daysCount,
    });
    await this.notifier.notifyAssociated(associateCtx, employee.FullName).catch(() => {});

    return this.prisma.missionOrder.findUniqueOrThrow({ where: { Id: primaryId }, include: MISSION_EMPLOYEE_INCLUDE });
  }

  async update(id: string, dto: UpdateMissionOrderDto, requesterEmployeeId: string, canOverride: boolean) {
    const existing = await this.findOneRaw(id);
    if (existing.EmployeeId !== requesterEmployeeId && existing.CreatedBy !== requesterEmployeeId && !canOverride) {
      throw new ForbiddenException("Vous ne pouvez modifier que vos propres ordres de mission");
    }
    if (!EDITABLE_STATUSES.includes(existing.Status)) {
      throw new BadRequestException('Seul un ordre en brouillon ou retourné peut être modifié');
    }

    const departureDate = dto.DepartureDate ? new Date(dto.DepartureDate) : existing.DepartureDate;
    const returnDate = dto.ReturnDate ? new Date(dto.ReturnDate) : existing.ReturnDate;
    const daysCount = dto.DepartureDate || dto.ReturnDate ? this.computeDays(departureDate, returnDate) : existing.DaysCount;

    return this.prisma.$transaction(async (tx) => {
      if (dto.ExpenseLines) {
        await tx.missionExpenseLine.deleteMany({ where: { MissionOrderId: id } });
        if (dto.ExpenseLines.length) {
          await tx.missionExpenseLine.createMany({
            data: dto.ExpenseLines.map((l) => ({
              MissionOrderId: id,
              ExpenseTypeId: l.ExpenseTypeId,
              Description: l.Description,
              Amount: l.Amount,
              CreatedBy: requesterEmployeeId,
            })),
          });
        }
      }
      return tx.missionOrder.update({
        where: { Id: id },
        data: {
          Destination: dto.Destination ?? existing.Destination,
          MissionCategory: dto.MissionCategory ?? existing.MissionCategory,
          Purpose: dto.Purpose ?? existing.Purpose,
          DepartureDate: departureDate,
          ReturnDate: returnDate,
          DaysCount: daysCount,
          TransportModeGo: dto.TransportModeGo ?? existing.TransportModeGo,
          TransportModeReturn: dto.TransportModeReturn ?? existing.TransportModeReturn,
          AdvanceRequested: dto.AdvanceRequested ?? existing.AdvanceRequested,
          Currency: dto.Currency ?? existing.Currency,
          ModifiedBy: requesterEmployeeId,
          ModifiedAt: new Date(),
        },
        include: MISSION_EMPLOYEE_INCLUDE,
      });
    });
  }

  async remove(id: string, requesterEmployeeId: string, canOverride: boolean) {
    const existing = await this.findOneRaw(id);
    if (existing.EmployeeId !== requesterEmployeeId && existing.CreatedBy !== requesterEmployeeId && !canOverride) {
      throw new ForbiddenException("Vous ne pouvez supprimer que vos propres ordres de mission");
    }
    if (existing.Status !== 'Draft') {
      throw new BadRequestException('Seul un ordre en brouillon peut être supprimé');
    }
    return this.prisma.missionOrder.delete({ where: { Id: id } });
  }

  // Suppression definitive (Lot I) — distincte de remove() ci-dessus
  // (reservee aux brouillons). Ici, n'importe quel ordre (quel que soit son
  // statut) peut etre cache de tout l'app (IsDeleted=true) sans toucher a
  // l'historique — reversible uniquement en base par un dev.
  // Un ordre de mission approuve ne doit plus jamais pouvoir disparaitre —
  // meme raisonnement que LeaveRequestService.softDelete (Lot I) : c'est la
  // trace qui justifie les indemnites versees. InApprovalN2+ est inclus
  // aussi : y arriver implique qu'un validateur (N1 au minimum) a deja
  // approuve une etape, sa decision ne doit pas pouvoir etre effacee sous
  // lui (decision du 12/08).
  private static readonly APPROVED_LINEAGE = ['Approved', 'InApprovalN2', 'InApprovalN3', 'InApprovalN4'];

  async softDelete(id: string, deletedBy: string) {
    const existing = await this.findOneRaw(id);
    if (MissionOrderService.APPROVED_LINEAGE.includes(existing.Status)) {
      throw new BadRequestException('Un ordre de mission déjà approuvé par un validateur ne peut plus être supprimé.');
    }
    const missionOrder = await this.prisma.missionOrder.update({
      where: { Id: id },
      data: { IsDeleted: true, DeletedBy: deletedBy, DeletedAt: new Date() },
    });
    this.realtime.broadcastCompany('data:changed', { domain: 'mission' });
    return missionOrder;
  }

  async findOne(id: string) {
    const missionOrder = await this.prisma.missionOrder.findUnique({
      where: { Id: id },
      include: {
        employee: { select: { Id: true, FullName: true, EmployeeNumber: true, EmployeeCategoryId: true } },
        createdByEmployee: { select: { Id: true, FullName: true } },
        missionExpenseLines: { include: { expenseType: true } },
      },
    });
    if (!missionOrder || missionOrder.IsDeleted) {
      throw new NotFoundException(`Ordre de mission ${id} introuvable`);
    }
    const decisions = await this.prisma.approvalDecision.findMany({
      where: { EntityType: 'MissionOrder', EntityId: id },
      orderBy: { StepOrder: 'asc' },
      include: { validatedByEmployee: { select: { Id: true, FullName: true } } },
    });
    const allowance = await this.computeAllowanceEstimate(
      missionOrder.employee.EmployeeCategoryId,
      missionOrder.MissionCategory,
      Number(missionOrder.DaysCount),
    );
    return { ...missionOrder, decisions, allowance };
  }

  // "Mes missions" inclut aussi celles creees pour un autre employe
  // (decision du 01/08) — le createur doit pouvoir suivre ce qu'il a soumis.
  // forEmployeeId (optionnel) etend le resultat aux missions du beneficiaire
  // vise par une note de frais en cours de creation pour lui — le picker
  // "Mission liee" doit proposer ses missions en plus des miennes.
  async findMine(employeeId: string, forEmployeeId?: string) {
    const employeeIds = forEmployeeId && forEmployeeId !== employeeId ? [employeeId, forEmployeeId] : [employeeId];
    const missions = await this.prisma.missionOrder.findMany({
      where: { OR: [{ EmployeeId: { in: employeeIds } }, { CreatedBy: employeeId }], IsDeleted: false },
      include: {
        employee: { select: { Id: true, FullName: true, EmployeeNumber: true } },
        createdByEmployee: { select: { Id: true, FullName: true } },
      },
      orderBy: { CreatedAt: 'desc' },
    });
    return this.attachEstimatedTotals(missions);
  }

  async findTeam(managerEmployeeId: string) {
    const unitIds = await this.collectManagedUnitIds(managerEmployeeId);
    if (unitIds.length === 0) return [];
    const missions = await this.prisma.missionOrder.findMany({
      where: { employee: { OrganizationUnitId: { in: unitIds } }, IsDeleted: false },
      include: MISSION_EMPLOYEE_INCLUDE,
      orderBy: { CreatedAt: 'desc' },
    });
    return this.attachEstimatedTotals(missions);
  }

  // Unites "geree" par un employe : celles dont il est le Responsable
  // designe, mais aussi celles ou il siege comme validateur d'un pool de
  // missions — un validateur doit garder une visibilite sur les demandes
  // de cette equipe meme une fois qu'elles remontent au-dela de son
  // niveau.
  private async collectManagedUnitIds(managerEmployeeId: string): Promise<string[]> {
    const [managedRoots, validatorPools] = await Promise.all([
      this.prisma.organizationUnit.findMany({
        where: { ManagerId: managerEmployeeId },
        select: { Id: true },
      }),
      this.prisma.approvalPool.findMany({
        where: { ObjectType: 'Mission', members: { some: { EmployeeId: managerEmployeeId } } },
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
    const missions = await this.prisma.missionOrder.findMany({
      where: { IsDeleted: false },
      include: MISSION_EMPLOYEE_INCLUDE,
      orderBy: { CreatedAt: 'desc' },
    });
    return this.attachEstimatedTotals(missions);
  }

  async findPendingForMe(employeeId: string) {
    const inApproval = await this.prisma.missionOrder.findMany({
      where: { Status: { in: ['InApprovalN1', 'InApprovalN2', 'InApprovalN3', 'InApprovalN4'] }, IsDeleted: false },
      include: {
        employee: { select: { Id: true, FullName: true, EmployeeNumber: true } },
        createdByEmployee: { select: { Id: true, FullName: true } },
      },
      orderBy: { CreatedAt: 'asc' },
    });
    const now = new Date();
    const result: typeof inApproval = [];
    for (const mo of inApproval) {
      const member = await this.prisma.approvalPoolMember.findFirst({
        where: { ApprovalPoolId: mo.ApprovalPoolId as string, StepOrder: mo.CurrentApprovalStep as number },
      });
      if (member && (await this.resolveActualApprover(member, now)) === employeeId) {
        result.push(mo);
      }
    }
    return this.attachEstimatedTotals(result);
  }

  // ── Workflow ─────────────────────────────────────────────────────────

  // Mission accompagnant (plan de test #22) — soumettre le titulaire soumet
  // aussi automatiquement la mission liee (encore en brouillon) : chacune
  // suit ensuite son propre pool de validation independamment (statuts et
  // emails separes). Le check de statut evite toute boucle si l'autre cote
  // tentait le meme cascade (deja plus en Draft/Returned a ce moment-la).
  // Best-effort : un echec cote associe (ex: pool non configure pour son
  // entite) ne doit pas faire echouer la soumission du titulaire.
  private async cascadeSubmitLinked(
    existing: Awaited<ReturnType<MissionOrderService['findOneRaw']>>,
    requesterEmployeeId: string,
  ) {
    if (!existing.LinkedMissionOrderId) return;
    try {
      const linked = await this.findOneRaw(existing.LinkedMissionOrderId);
      if (!EDITABLE_STATUSES.includes(linked.Status)) return;
      await this.submit(linked.Id, requesterEmployeeId, true);
    } catch {
      // silencieux : la mission de l'accompagnant reste en brouillon,
      // soumissible manuellement plus tard depuis sa propre fiche.
    }
  }

  async submit(id: string, requesterEmployeeId: string, canOverride: boolean) {
    const existing = await this.findOneRaw(id);
    if (existing.EmployeeId !== requesterEmployeeId && existing.CreatedBy !== requesterEmployeeId && !canOverride) {
      throw new ForbiddenException("Vous ne pouvez soumettre que vos propres ordres de mission");
    }
    if (!EDITABLE_STATUSES.includes(existing.Status)) {
      throw new BadRequestException('Seul un ordre en brouillon ou retourné peut être soumis');
    }

    const employee = await this.prisma.employee.findUniqueOrThrow({ where: { Id: existing.EmployeeId } });
    const pool = await this.approvalPoolService.findApplicablePool(employee.OrganizationUnitId, 'Mission');
    if (!pool) {
      throw new NotFoundException(
        "Aucun pool de validation de mission n'est configuré pour cette unité ou ses parents — contactez le RH",
      );
    }
    const sortedMembers = pool.members.slice().sort((a, b) => a.StepOrder - b.StepOrder);
    if (sortedMembers.length === 0) {
      throw new NotFoundException('Le pool de validation applicable ne contient aucun validateur');
    }

    // Voir LeaveRequestService.routeToApproval : c'est le beneficiaire
    // (existing.EmployeeId, pas forcement celui qui soumet) qui occupe
    // eventuellement un niveau de ce pool ; ce niveau ET tous ceux en
    // dessous sont alors consideres deja acquis, seuls les niveaux
    // au-dessus restent a valider.
    const beneficiaryEmployeeId = existing.EmployeeId;
    const beneficiaryOwnLevel = Math.max(
      0,
      ...sortedMembers.filter((m) => m.EmployeeId === beneficiaryEmployeeId).map((m) => m.StepOrder),
    );
    const candidateMembers = sortedMembers.filter((m) => m.StepOrder > beneficiaryOwnLevel);
    const applicable = await this.findApplicableStep(candidateMembers, beneficiaryEmployeeId);
    if (!applicable) {
      const updated = await this.prisma.missionOrder.update({
        where: { Id: id },
        data: {
          Status: 'Approved', ApprovalPoolId: pool.Id, RejectionReason: null,
          ModifiedBy: requesterEmployeeId, ModifiedAt: new Date(),
        },
        include: MISSION_EMPLOYEE_INCLUDE,
      });
      await this.notifier.notifyApproved(this.toContext(existing), { autoApproved: true });
      await this.cascadeSubmitLinked(existing, requesterEmployeeId);
      return updated;
    }

    const { member: firstStep, approverId } = applicable;
    const token = generateApprovalToken();
    const updated = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.missionOrder.update({
        where: { Id: id },
        data: {
          Status: `InApprovalN${firstStep.StepOrder}`,
          ApprovalPoolId: pool.Id,
          CurrentApprovalStep: firstStep.StepOrder,
          RejectionReason: null,
          ModifiedBy: requesterEmployeeId,
          ModifiedAt: new Date(),
        },
        include: MISSION_EMPLOYEE_INCLUDE,
      });
      await tx.approvalDecision.create({
        data: {
          EntityType: 'MissionOrder',
          EntityId: id,
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
    await this.notifier.notifySubmitted(this.toContext(existing), approverId, token);
    await this.cascadeSubmitLinked(existing, requesterEmployeeId);
    return updated;
  }

  private async assertIsCurrentApprover(
    missionOrder: Awaited<ReturnType<MissionOrderService['findOneRaw']>>,
    approverEmployeeId: string,
    canOverride: boolean,
  ) {
    if (canOverride) return;
    if (!missionOrder.ApprovalPoolId || missionOrder.CurrentApprovalStep == null) {
      throw new ForbiddenException("Cet ordre n'est pas en attente de validation");
    }
    const member = await this.prisma.approvalPoolMember.findFirst({
      where: { ApprovalPoolId: missionOrder.ApprovalPoolId, StepOrder: missionOrder.CurrentApprovalStep },
    });
    if (!member || (await this.resolveActualApprover(member, new Date())) !== approverEmployeeId) {
      throw new ForbiddenException("Vous n'êtes pas le validateur actuel de cet ordre de mission");
    }
  }

  async approve(id: string, dto: DecideMissionOrderDto, approverEmployeeId: string, canOverride: boolean) {
    const existing = await this.findOneRaw(id);
    await this.assertIsCurrentApprover(existing, approverEmployeeId, canOverride);

    const pendingDecision = await this.prisma.approvalDecision.findFirst({
      where: {
        EntityType: 'MissionOrder',
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
        const updated = await tx.missionOrder.update({
          where: { Id: id },
          data: { Status: `InApprovalN${nextStep.StepOrder}`, CurrentApprovalStep: nextStep.StepOrder },
          include: MISSION_EMPLOYEE_INCLUDE,
        });
        await tx.approvalDecision.create({
          data: {
            EntityType: 'MissionOrder',
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

      const updated = await tx.missionOrder.update({ where: { Id: id }, data: { Status: 'Approved' }, include: MISSION_EMPLOYEE_INCLUDE });
      return { updated, nextApproverId: null };
    });

    if (result.nextApproverId) {
      await this.notifier.notifyProgressed(this.toContext(existing), result.nextApproverId, nextToken as string);
    } else {
      await this.notifier.notifyApproved(this.toContext(existing), { autoApproved: false });
    }
    return result.updated;
  }

  async reject(id: string, dto: DecideMissionOrderDto, approverEmployeeId: string, canOverride: boolean) {
    if (!dto.Comment || dto.Comment.trim().length === 0) {
      throw new BadRequestException('Le motif du refus est requis');
    }
    const existing = await this.findOneRaw(id);
    await this.assertIsCurrentApprover(existing, approverEmployeeId, canOverride);
    const updated = await this.closeApprovalStep(existing, 'Rejected', dto.Comment, approverEmployeeId);
    await this.notifier.notifyRejected(this.toContext(existing), dto.Comment);
    return updated;
  }

  async return_(id: string, dto: DecideMissionOrderDto, approverEmployeeId: string, canOverride: boolean) {
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
    existing: Awaited<ReturnType<MissionOrderService['findOneRaw']>>,
    decision: 'Rejected' | 'Returned',
    comment: string,
    approverEmployeeId: string,
  ) {
    const pendingDecision = await this.prisma.approvalDecision.findFirst({
      where: {
        EntityType: 'MissionOrder',
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
      return tx.missionOrder.update({
        where: { Id: existing.Id },
        data: { Status: decision, RejectionReason: comment },
        include: MISSION_EMPLOYEE_INCLUDE,
      });
    });
  }

  async cancel(id: string, requesterEmployeeId: string, canOverride: boolean) {
    const existing = await this.findOneRaw(id);
    if (existing.EmployeeId !== requesterEmployeeId && existing.CreatedBy !== requesterEmployeeId && !canOverride) {
      throw new ForbiddenException("Vous ne pouvez annuler que vos propres ordres de mission");
    }
    if (!CANCELLABLE_STATUSES.includes(existing.Status)) {
      throw new BadRequestException(`Un ordre au statut "${existing.Status}" ne peut plus être annulé`);
    }
    const updated = await this.prisma.missionOrder.update({
      where: { Id: id },
      data: { Status: 'Cancelled', ModifiedBy: requesterEmployeeId, ModifiedAt: new Date() },
      include: MISSION_EMPLOYEE_INCLUDE,
    });
    await this.notifier.notifyCancelled(this.toContext(existing), requesterEmployeeId);
    return updated;
  }
}

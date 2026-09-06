import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ApprovalPoolService } from '../approval-pool/approval-pool.service';
import { WorkflowNotifierService, WorkflowContext } from '../notification/workflow-notifier.service';
import { generateApprovalToken } from '../../common/approval-token';
import { CreateExpenseReportDto } from './dto/create-expense-report.dto';
import { UpdateExpenseReportDto } from './dto/update-expense-report.dto';
import { DecideExpenseReportDto } from './dto/decide-expense-report.dto';
import { RealtimeGateway } from '../realtime/realtime.gateway';

const EDITABLE_STATUSES = ['Draft', 'Returned'];
const CANCELLABLE_STATUSES = ['Draft', 'InApprovalN1', 'InApprovalN2', 'InApprovalN3', 'InApprovalN4', 'Approved'];
const DEFAULT_CURRENCY = 'MGA';

// Le frontend recalcule toujours le total depuis les lignes (voir
// stores/expenses.ts mapExpenseReport) — chaque mutation de statut doit donc
// renvoyer les lignes, pas seulement les colonnes modifiées, sinon la carte
// affichée localement après l'action perd son détail jusqu'au prochain fetch.
// EmployeeCategoryId sur employee : necessaire au front pour resoudre le
// plafond (ExpenseCeiling) applicable au beneficiaire, cote createur ET
// validateur (voir decision du 12/08 : plafond non bloquant).
const REPORT_INCLUDE = {
  lines: { include: { expenseType: true } },
  employee: { select: { Id: true, FullName: true, EmployeeNumber: true, EmployeeCategoryId: true } },
  createdByEmployee: { select: { Id: true, FullName: true } },
} as const;

@Injectable()
export class ExpenseReportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly approvalPoolService: ApprovalPoolService,
    private readonly notifier: WorkflowNotifierService,
    private readonly realtime: RealtimeGateway,
  ) {}

  // ── Helpers ──────────────────────────────────────────────────────────

  private toContext(report: {
    Id: string; ReferenceCode: string; EmployeeId: string; CreatedBy: string;
    Title: string; Currency: string; lines?: { Amount: unknown }[];
  }): WorkflowContext {
    const total = this.computeTotal(report.lines ?? []);
    return {
      kind: 'expense',
      id: report.Id,
      referenceCode: report.ReferenceCode,
      beneficiaryId: report.EmployeeId,
      creatorId: report.CreatedBy,
      summary: report.Title,
      details: [
        { label: 'Titre', value: report.Title },
        { label: 'Montant total', value: `${total.toLocaleString('fr-FR')} ${report.Currency}` },
      ],
    };
  }

  private async generateReferenceCode(): Promise<string> {
    const year = new Date().getFullYear();
    const prefix = `NF-${year}-`;
    const count = await this.prisma.expenseReport.count({
      where: { ReferenceCode: { startsWith: prefix } },
    });
    return `${prefix}${String(count + 1).padStart(5, '0')}`;
  }

  private computeTotal(lines: { Amount: unknown }[]): number {
    return lines.reduce((s, l) => s + Number(l.Amount), 0);
  }

  private async findOneRaw(id: string) {
    const report = await this.prisma.expenseReport.findUnique({ where: { Id: id } });
    if (!report || report.IsDeleted) {
      throw new NotFoundException(`Note de frais ${id} introuvable`);
    }
    return report;
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

  // ── CRUD ─────────────────────────────────────────────────────────────

  // N'importe quel employe peut creer une note de frais pour n'importe quel
  // autre employe (decision du 01/08, aucune permission requise) — le
  // createur (CreatedBy) reste trace pour que lui et le beneficiaire (voir
  // findMine) gardent tous les deux la visibilite et la main sur la note.
  async create(dto: CreateExpenseReportDto, requesterEmployeeId: string) {
    const employeeId = dto.EmployeeId ?? requesterEmployeeId;
    const employee = await this.prisma.employee.findUnique({ where: { Id: employeeId } });
    if (!employee) {
      throw new NotFoundException(`Employé ${employeeId} introuvable`);
    }

    const currency = dto.Currency ?? DEFAULT_CURRENCY;
    const referenceCode = await this.generateReferenceCode();

    return this.prisma.expenseReport.create({
      data: {
        ReferenceCode: referenceCode,
        EmployeeId: employeeId,
        Title: dto.Title,
        MissionOrderId: dto.MissionOrderId,
        Currency: currency,
        Status: 'Draft',
        CreatedBy: requesterEmployeeId,
        lines: dto.Lines?.length
          ? {
              create: dto.Lines.map((l) => ({
                ExpenseDate: new Date(l.ExpenseDate),
                ExpenseTypeId: l.ExpenseTypeId,
                Description: l.Description,
                Amount: l.Amount,
                Currency: l.Currency ?? currency,
                HasDocument: l.HasDocument ?? false,
                CreatedBy: requesterEmployeeId,
              })),
            }
          : undefined,
      },
      include: REPORT_INCLUDE,
    });
  }

  async update(id: string, dto: UpdateExpenseReportDto, requesterEmployeeId: string, canOverride: boolean) {
    const existing = await this.findOneRaw(id);
    if (existing.EmployeeId !== requesterEmployeeId && existing.CreatedBy !== requesterEmployeeId && !canOverride) {
      throw new ForbiddenException("Vous ne pouvez modifier que vos propres notes de frais");
    }
    if (!EDITABLE_STATUSES.includes(existing.Status)) {
      throw new BadRequestException('Seule une note en brouillon ou retournée peut être modifiée');
    }

    return this.prisma.$transaction(async (tx) => {
      if (dto.Lines) {
        await tx.expenseLine.deleteMany({ where: { ExpenseReportId: id } });
        if (dto.Lines.length) {
          await tx.expenseLine.createMany({
            data: dto.Lines.map((l) => ({
              ExpenseReportId: id,
              ExpenseDate: new Date(l.ExpenseDate),
              ExpenseTypeId: l.ExpenseTypeId,
              Description: l.Description,
              Amount: l.Amount,
              Currency: l.Currency ?? existing.Currency,
              HasDocument: l.HasDocument ?? false,
              CreatedBy: requesterEmployeeId,
            })),
          });
        }
      }
      return tx.expenseReport.update({
        where: { Id: id },
        data: {
          Title: dto.Title ?? existing.Title,
          MissionOrderId: dto.MissionOrderId !== undefined ? dto.MissionOrderId : existing.MissionOrderId,
          Currency: dto.Currency ?? existing.Currency,
          ModifiedBy: requesterEmployeeId,
          ModifiedAt: new Date(),
        },
        include: REPORT_INCLUDE,
      });
    });
  }

  async remove(id: string, requesterEmployeeId: string, canOverride: boolean) {
    const existing = await this.findOneRaw(id);
    if (existing.EmployeeId !== requesterEmployeeId && existing.CreatedBy !== requesterEmployeeId && !canOverride) {
      throw new ForbiddenException("Vous ne pouvez supprimer que vos propres notes de frais");
    }
    if (existing.Status !== 'Draft') {
      throw new BadRequestException('Seule une note en brouillon peut être supprimée');
    }
    return this.prisma.expenseReport.delete({ where: { Id: id } });
  }

  // Suppression definitive (Lot I) — distincte de remove() ci-dessus
  // (reservee aux brouillons). Ici, n'importe quelle note (quel que soit son
  // statut) peut etre cachee de tout l'app (IsDeleted=true) sans toucher a
  // l'historique — reversible uniquement en base par un dev.
  // Une note approuvee (ou remboursee) ne doit plus jamais pouvoir
  // disparaitre — meme raisonnement que LeaveRequestService.softDelete
  // (Lot I) : c'est la trace qui justifie le remboursement. InApprovalN2+
  // est inclus aussi : y arriver implique qu'un validateur (N1 au minimum)
  // a deja approuve une etape, sa decision ne doit pas pouvoir etre effacee
  // sous lui (decision du 12/08).
  private static readonly APPROVED_LINEAGE = [
    'Approved', 'Reimbursed', 'InApprovalN2', 'InApprovalN3', 'InApprovalN4',
  ];

  async softDelete(id: string, deletedBy: string) {
    const existing = await this.findOneRaw(id);
    if (ExpenseReportService.APPROVED_LINEAGE.includes(existing.Status)) {
      throw new BadRequestException('Une note de frais déjà approuvée par un validateur ne peut plus être supprimée.');
    }
    const report = await this.prisma.expenseReport.update({
      where: { Id: id },
      data: { IsDeleted: true, DeletedBy: deletedBy, DeletedAt: new Date() },
    });
    this.realtime.broadcastCompany('data:changed', { domain: 'expense' });
    return report;
  }

  async findOne(id: string) {
    const report = await this.prisma.expenseReport.findUnique({
      where: { Id: id },
      include: {
        employee: { select: { Id: true, FullName: true, EmployeeNumber: true, EmployeeCategoryId: true } },
        createdByEmployee: { select: { Id: true, FullName: true } },
        lines: { include: { expenseType: true }, orderBy: { ExpenseDate: 'asc' } },
      },
    });
    if (!report || report.IsDeleted) {
      throw new NotFoundException(`Note de frais ${id} introuvable`);
    }
    const decisions = await this.prisma.approvalDecision.findMany({
      where: { EntityType: 'ExpenseReport', EntityId: id },
      orderBy: { StepOrder: 'asc' },
      include: { validatedByEmployee: { select: { Id: true, FullName: true } } },
    });
    return { ...report, decisions, TotalAmount: this.computeTotal(report.lines) };
  }

  private async attachTotals<T extends { lines: { Amount: unknown }[] }>(reports: T[]): Promise<(T & { TotalAmount: number })[]> {
    return reports.map((r) => ({ ...r, TotalAmount: this.computeTotal(r.lines) }));
  }

  // "Mes notes de frais" inclut aussi celles creees pour un autre employe
  // (decision du 01/08) — le createur doit pouvoir suivre ce qu'il a soumis.
  async findMine(employeeId: string) {
    const reports = await this.prisma.expenseReport.findMany({
      where: { OR: [{ EmployeeId: employeeId }, { CreatedBy: employeeId }], IsDeleted: false },
      include: {
        employee: { select: { Id: true, FullName: true, EmployeeNumber: true, EmployeeCategoryId: true } },
        createdByEmployee: { select: { Id: true, FullName: true } },
        lines: { include: { expenseType: true } },
      },
      orderBy: { CreatedAt: 'desc' },
    });
    return this.attachTotals(reports);
  }

  async findTeam(managerEmployeeId: string) {
    const unitIds = await this.collectManagedUnitIds(managerEmployeeId);
    if (unitIds.length === 0) return [];
    const reports = await this.prisma.expenseReport.findMany({
      where: { employee: { OrganizationUnitId: { in: unitIds } }, IsDeleted: false },
      include: REPORT_INCLUDE,
      orderBy: { CreatedAt: 'desc' },
    });
    return this.attachTotals(reports);
  }

  // Unites "geree" par un employe : celles dont il est le Responsable
  // designe, mais aussi celles ou il siege comme validateur d'un pool de
  // notes de frais — un validateur doit garder une visibilite sur les
  // demandes de cette equipe meme une fois qu'elles remontent au-dela de
  // son niveau.
  private async collectManagedUnitIds(managerEmployeeId: string): Promise<string[]> {
    const [managedRoots, validatorPools] = await Promise.all([
      this.prisma.organizationUnit.findMany({
        where: { ManagerId: managerEmployeeId },
        select: { Id: true },
      }),
      this.prisma.approvalPool.findMany({
        where: { ObjectType: 'ExpenseReport', members: { some: { EmployeeId: managerEmployeeId } } },
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
    const reports = await this.prisma.expenseReport.findMany({
      where: { IsDeleted: false },
      include: REPORT_INCLUDE,
      orderBy: { CreatedAt: 'desc' },
    });
    return this.attachTotals(reports);
  }

  async findPendingForMe(employeeId: string) {
    const inApproval = await this.prisma.expenseReport.findMany({
      where: { Status: { in: ['InApprovalN1', 'InApprovalN2', 'InApprovalN3', 'InApprovalN4'] }, IsDeleted: false },
      include: {
        employee: { select: { Id: true, FullName: true, EmployeeNumber: true, EmployeeCategoryId: true } },
        createdByEmployee: { select: { Id: true, FullName: true } },
        lines: { include: { expenseType: true } },
      },
      orderBy: { CreatedAt: 'asc' },
    });
    const now = new Date();
    const result: typeof inApproval = [];
    for (const r of inApproval) {
      const member = await this.prisma.approvalPoolMember.findFirst({
        where: { ApprovalPoolId: r.ApprovalPoolId as string, StepOrder: r.CurrentApprovalStep as number },
      });
      if (member && (await this.resolveActualApprover(member, now)) === employeeId) {
        result.push(r);
      }
    }
    return this.attachTotals(result);
  }

  // ── Workflow ─────────────────────────────────────────────────────────

  async submit(id: string, requesterEmployeeId: string, canOverride: boolean) {
    const existing = await this.findOneRaw(id);
    if (existing.EmployeeId !== requesterEmployeeId && existing.CreatedBy !== requesterEmployeeId && !canOverride) {
      throw new ForbiddenException("Vous ne pouvez soumettre que vos propres notes de frais");
    }
    if (!EDITABLE_STATUSES.includes(existing.Status)) {
      throw new BadRequestException('Seule une note en brouillon ou retournée peut être soumise');
    }
    const lineCount = await this.prisma.expenseLine.count({ where: { ExpenseReportId: id } });
    if (lineCount === 0) {
      throw new BadRequestException('Ajoutez au moins une ligne de dépense avant de soumettre');
    }

    // Le plafond par categorie d'employe (ExpenseCeiling) n'est plus bloquant
    // a la soumission (decision du 12/08, meme traitement que le solde de
    // conges) — la note est quand meme soumise, le front affiche
    // l'avertissement en rouge (createur ET validateur), qui decide en
    // connaissance de cause.
    const employee = await this.prisma.employee.findUniqueOrThrow({ where: { Id: existing.EmployeeId } });
    const pool = await this.approvalPoolService.findApplicablePool(employee.OrganizationUnitId, 'ExpenseReport');
    if (!pool) {
      throw new NotFoundException(
        "Aucun pool de validation de note de frais n'est configuré pour cette unité ou ses parents — contactez le RH",
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
      const updated = await this.prisma.expenseReport.update({
        where: { Id: id },
        data: {
          Status: 'Approved', ApprovalPoolId: pool.Id, RejectionReason: null,
          SubmittedAt: new Date(), ModifiedBy: requesterEmployeeId, ModifiedAt: new Date(),
        },
        include: REPORT_INCLUDE,
      });
      await this.notifier.notifyApproved(this.toContext(existing), { autoApproved: true });
      return updated;
    }

    const { member: firstStep, approverId } = applicable;
    const token = generateApprovalToken();
    const updated = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.expenseReport.update({
        where: { Id: id },
        data: {
          Status: `InApprovalN${firstStep.StepOrder}`,
          ApprovalPoolId: pool.Id,
          CurrentApprovalStep: firstStep.StepOrder,
          RejectionReason: null,
          SubmittedAt: new Date(),
          ModifiedBy: requesterEmployeeId,
          ModifiedAt: new Date(),
        },
        include: REPORT_INCLUDE,
      });
      await tx.approvalDecision.create({
        data: {
          EntityType: 'ExpenseReport',
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
    return updated;
  }

  private async assertIsCurrentApprover(
    report: Awaited<ReturnType<ExpenseReportService['findOneRaw']>>,
    approverEmployeeId: string,
    canOverride: boolean,
  ) {
    if (canOverride) return;
    if (!report.ApprovalPoolId || report.CurrentApprovalStep == null) {
      throw new ForbiddenException("Cette note n'est pas en attente de validation");
    }
    const member = await this.prisma.approvalPoolMember.findFirst({
      where: { ApprovalPoolId: report.ApprovalPoolId, StepOrder: report.CurrentApprovalStep },
    });
    if (!member || (await this.resolveActualApprover(member, new Date())) !== approverEmployeeId) {
      throw new ForbiddenException("Vous n'êtes pas le validateur actuel de cette note de frais");
    }
  }

  async approve(id: string, dto: DecideExpenseReportDto, approverEmployeeId: string, canOverride: boolean) {
    const existing = await this.findOneRaw(id);
    await this.assertIsCurrentApprover(existing, approverEmployeeId, canOverride);

    const pendingDecision = await this.prisma.approvalDecision.findFirst({
      where: {
        EntityType: 'ExpenseReport',
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
        const updated = await tx.expenseReport.update({
          where: { Id: id },
          data: { Status: `InApprovalN${nextStep.StepOrder}`, CurrentApprovalStep: nextStep.StepOrder },
          include: REPORT_INCLUDE,
        });
        await tx.approvalDecision.create({
          data: {
            EntityType: 'ExpenseReport',
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

      const updated = await tx.expenseReport.update({ where: { Id: id }, data: { Status: 'Approved' }, include: REPORT_INCLUDE });
      return { updated, nextApproverId: null };
    });

    if (result.nextApproverId) {
      await this.notifier.notifyProgressed(this.toContext(existing), result.nextApproverId, nextToken as string);
    } else {
      await this.notifier.notifyApproved(this.toContext(existing), { autoApproved: false });
    }
    return result.updated;
  }

  async reject(id: string, dto: DecideExpenseReportDto, approverEmployeeId: string, canOverride: boolean) {
    if (!dto.Comment || dto.Comment.trim().length === 0) {
      throw new BadRequestException('Le motif du refus est requis');
    }
    const existing = await this.findOneRaw(id);
    await this.assertIsCurrentApprover(existing, approverEmployeeId, canOverride);
    const updated = await this.closeApprovalStep(existing, 'Rejected', dto.Comment, approverEmployeeId);
    await this.notifier.notifyRejected(this.toContext(existing), dto.Comment);
    return updated;
  }

  async return_(id: string, dto: DecideExpenseReportDto, approverEmployeeId: string, canOverride: boolean) {
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
    existing: Awaited<ReturnType<ExpenseReportService['findOneRaw']>>,
    decision: 'Rejected' | 'Returned',
    comment: string,
    approverEmployeeId: string,
  ) {
    const pendingDecision = await this.prisma.approvalDecision.findFirst({
      where: {
        EntityType: 'ExpenseReport',
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
      return tx.expenseReport.update({
        where: { Id: existing.Id },
        data: { Status: decision, RejectionReason: comment },
        include: REPORT_INCLUDE,
      });
    });
  }

  async cancel(id: string, requesterEmployeeId: string, canOverride: boolean) {
    const existing = await this.findOneRaw(id);
    if (existing.EmployeeId !== requesterEmployeeId && existing.CreatedBy !== requesterEmployeeId && !canOverride) {
      throw new ForbiddenException("Vous ne pouvez annuler que vos propres notes de frais");
    }
    if (!CANCELLABLE_STATUSES.includes(existing.Status)) {
      throw new BadRequestException(`Une note au statut "${existing.Status}" ne peut plus être annulée`);
    }
    const updated = await this.prisma.expenseReport.update({
      where: { Id: id },
      data: { Status: 'Cancelled', ModifiedBy: requesterEmployeeId, ModifiedAt: new Date() },
      include: REPORT_INCLUDE,
    });
    await this.notifier.notifyCancelled(this.toContext(existing), requesterEmployeeId);
    return updated;
  }
}

import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '../../../../prisma/generated/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { ApprovalPoolService } from '../../approval-pool/approval-pool.service';
import { NotificationService } from '../../notification/notification.service';
import { isEntryWindowOpen } from './entry-window';
import { CreateTimeEntryDto, DecideTimeEntryDto, QueryTimeEntriesDto, UpdateTimeEntryDto } from './time-entry.dto';

const ENTITY_TYPE = 'TimeEntry';
const INCLUDE = {
  employee: { select: { Id: true, FullName: true, EmployeeNumber: true } },
  submittedBy: { select: { Id: true, FullName: true } },
  validatedBy: { select: { Id: true, FullName: true } },
} as const;

const toDate = (key: string) => new Date(`${key.slice(0, 10)}T00:00:00Z`);
const todayKey = () => new Date().toISOString().slice(0, 10);
const keyOf = (d: Date) => d.toISOString().slice(0, 10);

// Saisies de temps (mission, reunion, panier, permanence...) et leur validation
// par le circuit du HRM : validateur direct de l'employe s'il en a un, sinon
// pool d'approbation de type 'TimeEntry' de son entite (ou d'une entite
// parente). Les decisions sont des ApprovalDecision (EntityType = 'TimeEntry').
@Injectable()
export class TimeEntryService {
  private readonly logger = new Logger(TimeEntryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly approvalPools: ApprovalPoolService,
    private readonly notifications: NotificationService,
  ) {}

  // ── Routage ───────────────────────────────────────────────────────────────

  // Meme regle que les conges : un validateur en conge approuve (avec interimaire)
  // est remplace par son interimaire.
  private async resolveActualApprover(member: { EmployeeId: string; InterimEmployeeId: string | null }, at: Date) {
    if (!member.InterimEmployeeId) return member.EmployeeId;
    const onLeave = await this.prisma.leaveRequest.findFirst({
      where: { EmployeeId: member.EmployeeId, Status: 'Approved', StartDate: { lte: at }, EndDate: { gte: at }, IsDeleted: false },
    });
    return onLeave ? member.InterimEmployeeId : member.EmployeeId;
  }

  private async findApplicableStep<T extends { EmployeeId: string; InterimEmployeeId: string | null }>(
    sortedMembers: T[],
    beneficiaryId: string,
  ): Promise<{ member: T; approverId: string } | undefined> {
    for (const member of sortedMembers) {
      const approverId = await this.resolveActualApprover(member, new Date());
      if (approverId !== beneficiaryId) return { member, approverId };
    }
    return undefined;
  }

  // Place la saisie dans le circuit : approuvee d'office si personne d'autre que
  // le beneficiaire ne peut la valider, sinon en attente du premier validateur.
  private async route(entryId: string, employeeId: string, actorId: string) {
    const employee = await this.prisma.employee.findUniqueOrThrow({
      where: { Id: employeeId },
      select: { OrganizationUnitId: true, DirectValidatorId: true },
    });

    if (employee.DirectValidatorId) {
      if (employee.DirectValidatorId === employeeId) return this.autoApprove(entryId, null, actorId);
      return this.openStep(entryId, null, 1, employee.DirectValidatorId, null, actorId);
    }

    const pool = await this.approvalPools.findApplicablePool(employee.OrganizationUnitId, ENTITY_TYPE);
    if (!pool) {
      throw new NotFoundException(
        "Aucun pool de validation des temps n'est configuré dans l'entité de cet employé (ni dans une entité parente), et il n'a pas de validateur direct : contactez le RH",
      );
    }
    const sorted = pool.members.slice().sort((a, b) => a.StepOrder - b.StepOrder);
    if (sorted.length === 0) throw new NotFoundException('Le pool de validation applicable ne contient aucun validateur');

    // Le niveau du beneficiaire et ceux en dessous sont acquis.
    const ownLevel = Math.max(0, ...sorted.filter((m) => m.EmployeeId === employeeId).map((m) => m.StepOrder));
    const applicable = await this.findApplicableStep(sorted.filter((m) => m.StepOrder > ownLevel), employeeId);
    if (!applicable) return this.autoApprove(entryId, pool.Id, actorId);
    return this.openStep(entryId, pool.Id, applicable.member.StepOrder, applicable.approverId, applicable.member.Id, actorId);
  }

  private async autoApprove(entryId: string, poolId: string | null, actorId: string) {
    const updated = await this.prisma.$transaction(async (tx) => {
      const entry = await tx.timeManualEntry.update({
        where: { Id: entryId },
        data: { Status: 'Approved', ApprovalPoolId: poolId, CurrentApprovalStep: null, RejectionReason: null, ValidatedById: actorId, ModifiedAt: new Date() },
        include: INCLUDE,
      });
      await tx.timeManualEntryHistory.create({ data: { EntryId: entryId, Action: 'APPROVE', ActorId: actorId, Comment: 'Approbation automatique' } });
      return entry;
    });
    await this.notify(updated.EmployeeId, 'Saisie de temps approuvée', `Votre saisie du ${keyOf(updated.Date)} est approuvée.`);
    return updated;
  }

  private async openStep(
    entryId: string,
    poolId: string | null,
    step: number,
    approverId: string,
    poolMemberId: string | null,
    actorId: string,
  ) {
    const updated = await this.prisma.$transaction(async (tx) => {
      const entry = await tx.timeManualEntry.update({
        where: { Id: entryId },
        data: { Status: 'Pending', ApprovalPoolId: poolId, CurrentApprovalStep: step, RejectionReason: null, ValidatedById: null, ModifiedAt: new Date() },
        include: INCLUDE,
      });
      await tx.approvalDecision.create({
        data: {
          EntityType: ENTITY_TYPE,
          EntityId: entryId,
          ApprovalPoolMemberId: poolMemberId,
          DirectValidatorEmployeeId: poolMemberId ? null : approverId,
          ValidatedByEmployeeId: approverId,
          StepOrder: step,
          Decision: 'Pending',
          CreatedBy: actorId,
        },
      });
      return entry;
    });
    await this.notify(
      approverId,
      'Saisie de temps à valider',
      `${updated.employee.FullName} a saisi ${Number(updated.Hours)} h le ${keyOf(updated.Date)}.`,
      '/hr/time/validation',
    );
    return updated;
  }

  private async notify(employeeId: string, title: string, message: string, href = '/my-space/time') {
    try {
      await this.notifications.create({ employeeId, type: 'system', title, message, href });
    } catch (err) {
      this.logger.warn(`Notification non envoyée : ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // ── Saisie ────────────────────────────────────────────────────────────────

  private assertWindow(dateKey: string, isHr: boolean) {
    if (!isEntryWindowOpen(dateKey, todayKey(), isHr)) {
      throw new BadRequestException(
        isHr
          ? 'La période de saisie est close (jusqu\'au 15 du mois suivant pour le RH)'
          : 'La période de saisie est close pour cette date (jusqu\'à la fin du mois)',
      );
    }
  }

  // Un panier ou une permanence ne se declare qu'une fois par jour.
  private async assertNoDuplicate(employeeId: string, dateKey: string, entryType: string, exceptId?: string) {
    if (entryType !== 'panier' && entryType !== 'permanence') return;
    const dup = await this.prisma.timeManualEntry.findFirst({
      where: {
        EmployeeId: employeeId,
        Date: toDate(dateKey),
        EntryType: entryType,
        Status: { in: ['Pending', 'Approved'] },
        ...(exceptId ? { Id: { not: exceptId } } : {}),
      },
      select: { Id: true },
    });
    if (dup) throw new BadRequestException(`Un(e) ${entryType} est déjà déclaré(e) ce jour pour cet employé`);
  }

  async create(dto: CreateTimeEntryDto, actorId: string, permissions: Set<string>) {
    const isHr = permissions.has('TEMPS_ACCES');
    const employeeId = dto.EmployeeId ?? actorId;
    if (employeeId !== actorId && !isHr) throw new ForbiddenException('Saisie pour un autre employé réservée au RH');
    if (employeeId === actorId && !isHr && !permissions.has('TEMPS_SAISIR')) throw new ForbiddenException();
    const target = await this.prisma.employee.findFirst({ where: { Id: employeeId, IsDeleted: false }, select: { Id: true } });
    if (!target) throw new NotFoundException('Employé introuvable');

    this.assertWindow(dto.Date.slice(0, 10), isHr);
    await this.assertNoDuplicate(employeeId, dto.Date.slice(0, 10), dto.EntryType);

    const entry = await this.prisma.$transaction(async (tx) => {
      const created = await tx.timeManualEntry.create({
        data: {
          EmployeeId: employeeId,
          SubmittedById: actorId,
          Date: toDate(dto.Date),
          Hours: dto.Hours,
          EntryType: dto.EntryType,
          Comments: dto.Comments,
          Status: 'Pending',
        },
      });
      await tx.timeManualEntryHistory.create({ data: { EntryId: created.Id, Action: 'CREATE', ActorId: actorId } });
      return created;
    });
    try {
      return await this.route(entry.Id, employeeId, actorId);
    } catch (err) {
      // Pas de circuit configure : on n'abandonne pas une saisie orpheline.
      await this.prisma.timeManualEntryHistory.deleteMany({ where: { EntryId: entry.Id } });
      await this.prisma.timeManualEntry.delete({ where: { Id: entry.Id } });
      throw err;
    }
  }

  private async findRaw(id: string) {
    const entry = await this.prisma.timeManualEntry.findUnique({ where: { Id: id }, include: INCLUDE });
    if (!entry) throw new NotFoundException(`Saisie ${id} introuvable`);
    return entry;
  }

  private assertOwnerOrHr(entry: { EmployeeId: string; SubmittedById: string }, actorId: string, isHr: boolean) {
    if (!isHr && entry.EmployeeId !== actorId && entry.SubmittedById !== actorId) {
      throw new ForbiddenException('Vous ne pouvez modifier que vos propres saisies');
    }
  }

  // Modification d'une saisie en attente ou refusee : elle repart dans le circuit.
  async update(id: string, dto: UpdateTimeEntryDto, actorId: string, permissions: Set<string>) {
    const isHr = permissions.has('TEMPS_ACCES');
    const existing = await this.findRaw(id);
    this.assertOwnerOrHr(existing, actorId, isHr);
    if (existing.Status !== 'Pending' && existing.Status !== 'Rejected') {
      throw new BadRequestException(`Une saisie "${existing.Status}" ne peut plus être modifiée`);
    }
    const newDate = dto.Date ? dto.Date.slice(0, 10) : keyOf(existing.Date);
    const newType = dto.EntryType ?? existing.EntryType ?? 'mission';
    this.assertWindow(keyOf(existing.Date), isHr);
    this.assertWindow(newDate, isHr);
    await this.assertNoDuplicate(existing.EmployeeId, newDate, newType, id);

    await this.prisma.$transaction(async (tx) => {
      await tx.approvalDecision.updateMany({
        where: { EntityType: ENTITY_TYPE, EntityId: id, Decision: 'Pending' },
        data: { Decision: 'Cancelled', DecidedAt: new Date() },
      });
      await tx.timeManualEntry.update({
        where: { Id: id },
        data: {
          Date: dto.Date ? toDate(dto.Date) : undefined,
          Hours: dto.Hours,
          EntryType: dto.EntryType,
          Comments: dto.Comments,
          ModifiedAt: new Date(),
        },
      });
      await tx.timeManualEntryHistory.create({ data: { EntryId: id, Action: 'UPDATE', ActorId: actorId } });
    });
    return this.route(id, existing.EmployeeId, actorId);
  }

  async cancel(id: string, actorId: string, permissions: Set<string>) {
    const existing = await this.findRaw(id);
    this.assertOwnerOrHr(existing, actorId, permissions.has('TEMPS_ACCES'));
    if (existing.Status !== 'Pending') throw new BadRequestException('Seule une saisie en attente peut être annulée');
    return this.prisma.$transaction(async (tx) => {
      await tx.approvalDecision.updateMany({
        where: { EntityType: ENTITY_TYPE, EntityId: id, Decision: 'Pending' },
        data: { Decision: 'Cancelled', DecidedAt: new Date() },
      });
      await tx.timeManualEntryHistory.create({ data: { EntryId: id, Action: 'UPDATE', ActorId: actorId, Comment: 'Annulée' } });
      return tx.timeManualEntry.update({
        where: { Id: id },
        data: { Status: 'Cancelled', CurrentApprovalStep: null, ModifiedAt: new Date() },
        include: INCLUDE,
      });
    });
  }

  // ── Decision ──────────────────────────────────────────────────────────────

  private async assertIsCurrentApprover(
    entry: Awaited<ReturnType<TimeEntryService['findRaw']>>,
    approverId: string,
    canOverride: boolean,
  ) {
    if (entry.Status !== 'Pending') {
      throw new BadRequestException(`Cette saisie n'est plus en attente de validation (statut "${entry.Status}")`);
    }
    if (canOverride) return;
    if (entry.CurrentApprovalStep == null) throw new ForbiddenException("Cette saisie n'est pas en attente de validation");
    const decision = await this.prisma.approvalDecision.findFirst({
      where: { EntityType: ENTITY_TYPE, EntityId: entry.Id, StepOrder: entry.CurrentApprovalStep, Decision: 'Pending' },
    });
    if (!decision || decision.ValidatedByEmployeeId !== approverId) {
      throw new ForbiddenException("Vous n'êtes pas le validateur actuel de cette saisie");
    }
  }

  async approve(id: string, dto: DecideTimeEntryDto, approverId: string, permissions: Set<string>) {
    const existing = await this.findRaw(id);
    await this.assertIsCurrentApprover(existing, approverId, permissions.has('TEMPS_ACCES'));
    const pending = await this.prisma.approvalDecision.findFirst({
      where: { EntityType: ENTITY_TYPE, EntityId: id, StepOrder: existing.CurrentApprovalStep as number, Decision: 'Pending' },
    });
    if (!pending) throw new BadRequestException('Aucune décision en attente pour cette étape');

    let next: { member: { Id: string; StepOrder: number; EmployeeId: string; InterimEmployeeId: string | null }; approverId: string } | undefined;
    if (existing.ApprovalPoolId) {
      const pool = await this.prisma.approvalPool.findUniqueOrThrow({ where: { Id: existing.ApprovalPoolId }, include: { members: true } });
      const remaining = pool.members.filter((m) => m.StepOrder > (existing.CurrentApprovalStep as number)).sort((a, b) => a.StepOrder - b.StepOrder);
      next = await this.findApplicableStep(remaining, existing.EmployeeId);
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.approvalDecision.update({
        where: { Id: pending.Id },
        data: { Decision: 'Approved', Comment: dto.Comment, DecidedAt: new Date(), ValidatedByEmployeeId: approverId },
      });
      await tx.timeManualEntryHistory.create({ data: { EntryId: id, Action: 'APPROVE', ActorId: approverId, Comment: dto.Comment } });
      if (next) {
        await tx.approvalDecision.create({
          data: {
            EntityType: ENTITY_TYPE,
            EntityId: id,
            ApprovalPoolMemberId: next.member.Id,
            ValidatedByEmployeeId: next.approverId,
            StepOrder: next.member.StepOrder,
            Decision: 'Pending',
            CreatedBy: approverId,
          },
        });
        return tx.timeManualEntry.update({ where: { Id: id }, data: { CurrentApprovalStep: next.member.StepOrder, ModifiedAt: new Date() }, include: INCLUDE });
      }
      return tx.timeManualEntry.update({
        where: { Id: id },
        data: { Status: 'Approved', CurrentApprovalStep: null, ValidatedById: approverId, ModifiedAt: new Date() },
        include: INCLUDE,
      });
    });

    if (next) {
      await this.notify(next.approverId, 'Saisie de temps à valider', `${existing.employee.FullName} : saisie du ${keyOf(existing.Date)}.`, '/hr/time/validation');
    } else {
      await this.notify(existing.EmployeeId, 'Saisie de temps approuvée', `Votre saisie du ${keyOf(existing.Date)} est approuvée.`);
    }
    return updated;
  }

  async reject(id: string, dto: DecideTimeEntryDto, approverId: string, permissions: Set<string>) {
    if (!dto.Comment || dto.Comment.trim().length === 0) throw new BadRequestException('Le motif du refus est requis');
    const existing = await this.findRaw(id);
    await this.assertIsCurrentApprover(existing, approverId, permissions.has('TEMPS_ACCES'));
    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.approvalDecision.updateMany({
        where: { EntityType: ENTITY_TYPE, EntityId: id, Decision: 'Pending' },
        data: { Decision: 'Rejected', Comment: dto.Comment, DecidedAt: new Date(), ValidatedByEmployeeId: approverId },
      });
      await tx.timeManualEntryHistory.create({ data: { EntryId: id, Action: 'REJECT', ActorId: approverId, Comment: dto.Comment } });
      return tx.timeManualEntry.update({
        where: { Id: id },
        data: { Status: 'Rejected', RejectionReason: dto.Comment, CurrentApprovalStep: null, ValidatedById: approverId, ModifiedAt: new Date() },
        include: INCLUDE,
      });
    });
    await this.notify(existing.EmployeeId, 'Saisie de temps refusée', `Votre saisie du ${keyOf(existing.Date)} est refusée : ${dto.Comment}`);
    return updated;
  }

  // ── Lecture ───────────────────────────────────────────────────────────────

  private buildWhere(q: QueryTimeEntriesDto, base: Prisma.TimeManualEntryWhereInput = {}): Prisma.TimeManualEntryWhereInput {
    return {
      ...base,
      ...(q.EmployeeId ? { EmployeeId: q.EmployeeId } : {}),
      ...(q.Status ? { Status: q.Status } : {}),
      ...(q.EntryType ? { EntryType: q.EntryType } : {}),
      ...(q.From || q.To ? { Date: { ...(q.From ? { gte: toDate(q.From) } : {}), ...(q.To ? { lte: toDate(q.To) } : {}) } } : {}),
    };
  }

  private async page(where: Prisma.TimeManualEntryWhereInput, q: QueryTimeEntriesDto) {
    const page = q.Page ?? 1;
    const limit = q.Limit ?? 50;
    const [data, total] = await Promise.all([
      this.prisma.timeManualEntry.findMany({ where, include: INCLUDE, orderBy: [{ Date: 'desc' }, { CreatedAt: 'desc' }], skip: (page - 1) * limit, take: limit }),
      this.prisma.timeManualEntry.count({ where }),
    ]);
    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  findMine(employeeId: string, q: QueryTimeEntriesDto) {
    return this.page(this.buildWhere({ ...q, EmployeeId: undefined }, { EmployeeId: employeeId }), q);
  }

  findAll(q: QueryTimeEntriesDto) {
    return this.page(this.buildWhere(q), q);
  }

  // Saisies en attente de MA decision (ou toutes pour le RH).
  async findPendingForMe(approverId: string, permissions: Set<string>, q: QueryTimeEntriesDto) {
    if (permissions.has('TEMPS_ACCES')) return this.page(this.buildWhere({ ...q, Status: 'Pending' }), q);
    const decisions = await this.prisma.approvalDecision.findMany({
      where: { EntityType: ENTITY_TYPE, Decision: 'Pending', ValidatedByEmployeeId: approverId },
      select: { EntityId: true },
    });
    return this.page(this.buildWhere({ ...q, Status: 'Pending' }, { Id: { in: decisions.map((d) => d.EntityId) } }), q);
  }

  async history(id: string, actorId: string, permissions: Set<string>) {
    const entry = await this.findRaw(id);
    const mine = entry.EmployeeId === actorId || entry.SubmittedById === actorId;
    if (!mine && !permissions.has('TEMPS_ACCES') && !permissions.has('TEMPS_VALIDER')) throw new ForbiddenException();
    return this.prisma.timeManualEntryHistory.findMany({ where: { EntryId: id }, orderBy: { CreatedAt: 'asc' } });
  }
}

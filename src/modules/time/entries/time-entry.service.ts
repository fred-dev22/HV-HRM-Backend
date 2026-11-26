import { BadRequestException, ForbiddenException, HttpException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '../../../../prisma/generated/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { ApprovalPoolService } from '../../approval-pool/approval-pool.service';
import { NotificationService } from '../../notification/notification.service';
import {
  canDecide,
  directValidatorSpec,
  findApplicableStep as findApplicableApproverStep,
  isOnApprovedLeave,
  resolveApprovers,
} from '../../../common/utils/approver-resolution.util';
import { isEntryWindowOpen } from './entry-window';
import { BATCH_MAX_DAYS, BATCH_MAX_ENTRIES, BATCH_SKIP_LABELS, BatchPlan, datesInRange, declaredKey, isFullLeaveDay, planBatch } from './entry-batch';
import {
  ExistingEntry,
  LineResult,
  PlannedLine,
  Slot,
  isIncomplete,
  isOncePerDay,
  isWorkType,
  exitMinutes,
  minutesOf,
  overlapsAcross,
  planLines,
  slotLabel,
} from './entry-lines';
import { WORK_ENTRY_TYPES } from '../calculation/work-records';
import { assertWeekOpen, removeControl, validatedWeeks, weekKey } from '../weeks/week-lock';
import { TimeCalculationService } from '../calculation/time-calculation.service';
import { NIGHT_SHIFT_MAX_HOURS } from '../../calendar/calendar-hours';
import {
  AdjustTimeEntryDto,
  CreateTimeEntryBatchDto,
  CreateTimeEntryDto,
  CreateTimeEntryLinesDto,
  DecideTimeEntryDto,
  QueryTimeEntriesDto,
  UpdateTimeEntryDto,
  TIME_ENTRY_TYPES,
  TIME_PATTERN,
} from './time-entry.dto';

const ENTITY_TYPE = 'TimeEntry';
const INCLUDE = {
  employee: { select: { Id: true, FullName: true, EmployeeNumber: true } },
  submittedBy: { select: { Id: true, FullName: true } },
  validatedBy: { select: { Id: true, FullName: true } },
} as const;

const toDate = (key: string) => new Date(`${key.slice(0, 10)}T00:00:00Z`);
const todayKey = () => new Date().toISOString().slice(0, 10);
const keyOf = (d: Date) => d.toISOString().slice(0, 10);
const shiftDays = (key: string, days: number) => new Date(toDate(key).getTime() + days * 86_400_000);

// Duree et horodatages d'une saisie. Avec heure de debut et de fin, la duree
// s'en deduit ; sinon la duree declaree est obligatoire. Les horodatages sont
// l'heure murale du serveur, comme les pointages importes.
export function resolveTimes(dateKey: string, hours: number | undefined, start?: string, end?: string) {
  if (!start && !end) {
    if (!hours) throw new BadRequestException("Indiquez la durée, ou l'heure de début et l'heure de fin");
    return { hours, clockIn: null as Date | null, clockOut: null as Date | null };
  }
  if (!start || !end) {
    // Entree ou sortie seule (oubli de pointage) : enregistree, a completer avant validation.
    if (hours) throw new BadRequestException("Indiquez soit les horaires, soit la durée");
    return {
      hours: 0,
      clockIn: start ? new Date(`${dateKey}T${start}:00`) : null,
      clockOut: end ? new Date(`${dateKey}T${end}:00`) : null,
    };
  }
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  let minutes = eh! * 60 + em! - (sh! * 60 + sm!);
  if (minutes === 0) throw new BadRequestException("L'heure de fin doit être différente de l'heure de début");
  // Fin avant le debut : poste de nuit, la sortie a lieu le lendemain.
  const overnight = minutes < 0;
  if (overnight) minutes += 24 * 60;
  if (overnight && minutes > NIGHT_SHIFT_MAX_HOURS * 60) {
    throw new BadRequestException(`Un poste de nuit ne dépasse pas ${NIGHT_SHIFT_MAX_HOURS} h : vérifiez les heures de début et de fin`);
  }
  const clockOut = new Date(`${dateKey}T${end}:00`);
  if (overnight) clockOut.setDate(clockOut.getDate() + 1);
  return {
    hours: Math.round((minutes / 60) * 100) / 100,
    clockIn: new Date(`${dateKey}T${start}:00`),
    clockOut,
  };
}

// Periode d'une saisie, pour les controles de chevauchement.
const slotFrom = (entryType: string, times: ReturnType<typeof resolveTimes>): Slot => ({
  entryType,
  start: minutesOf(times.clockIn),
  end: exitMinutes(times.clockIn, times.clockOut),
  hours: times.hours,
});
const toSlot = (e: { EntryType: string | null; FirstClockIn: Date | null; LastClockOut: Date | null; Hours: unknown }): Slot => ({
  entryType: e.EntryType ?? '',
  start: minutesOf(e.FirstClockIn),
  end: exitMinutes(e.FirstClockIn, e.LastClockOut),
  hours: Number(e.Hours),
});

// Horaires d'une ligne envoyee : controle ici (et non par le ValidationPipe) pour
// qu'une ligne fausse n'entraine pas le refus de tout le fichier.
function lineTimes(
  dateKey: string,
  line: { EntryType: string; StartTime?: string; EndTime?: string; Hours?: number },
): ReturnType<typeof resolveTimes> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey) || Number.isNaN(toDate(dateKey).getTime()) || keyOf(toDate(dateKey)) !== dateKey) {
    throw new BadRequestException('Date invalide (AAAA-MM-JJ)');
  }
  if (!(TIME_ENTRY_TYPES as readonly string[]).includes(line.EntryType)) throw new BadRequestException('Type de saisie inconnu');
  // Un panier ou une permanence compte pour 1 par jour, sans horaires.
  if (isOncePerDay(line.EntryType)) return resolveTimes(dateKey, 1);
  const start = line.StartTime || undefined;
  const end = line.EndTime || undefined;
  for (const time of [start, end]) {
    if (time && !TIME_PATTERN.test(time)) throw new BadRequestException('Heure au format HH:mm attendue');
  }
  if (line.Hours !== undefined && !(line.Hours > 0 && line.Hours <= 24)) throw new BadRequestException('Durée entre 0 et 24 h');
  return resolveTimes(dateKey, start || end ? undefined : line.Hours, start, end);
}

// Statuts d'une demande de conge acquise (y compris les declarations medicales).
const TAKEN_LEAVE_STATUSES = ['Approved', 'Registered', 'Done', 'Regularized'];
const frDate = (key: string) => key.split('-').reverse().join('/');

// Pendant une saisie en lot, les notifications sont regroupees : une seule par
// destinataire au lieu d'une par journee.
interface NotificationDigest {
  toValidate: Map<string, number>;
  coApprovers: Map<string, { primaryId: string; count: number }>;
  approved: Map<string, number>;
}

const fmtHours = (h: number) => `${String(h).replace('.', ',')} h`;

// Texte d'historique d'un ajustement : ancienne et nouvelle duree, plage horaire
// et motif eventuel. Tient dans les 500 caracteres de la colonne.
export function describeAdjustment(before: number, after: number, start?: string, end?: string, reason?: string): string {
  const range = start && end ? ` (${start} à ${end}${end < start ? ' le lendemain' : ''})` : '';
  const why = reason && reason.trim() ? ` : ${reason.trim()}` : '';
  return `Durée ${fmtHours(before)} → ${fmtHours(after)}${range}${why}`.slice(0, 500);
}

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
    private readonly calculation: TimeCalculationService,
  ) {}

  // ── Routage ───────────────────────────────────────────────────────────────

  // Meme regle que les conges, les missions et les notes de frais : l'interimaire
  // du validateur voit la saisie en meme temps que lui, a tout moment.
  private findApplicableStep<T extends { EmployeeId: string; InterimEmployeeId: string | null; StepOrder: number }>(
    sortedMembers: T[],
    beneficiaryId: string,
  ) {
    return findApplicableApproverStep(sortedMembers, beneficiaryId);
  }

  // Place la saisie dans le circuit : approuvee d'office si personne d'autre que
  // le beneficiaire ne peut la valider, sinon en attente du premier validateur.
  private async route(entryId: string, employeeId: string, actorId: string, digest?: NotificationDigest) {
    const employee = await this.prisma.employee.findUniqueOrThrow({
      where: { Id: employeeId },
      select: { OrganizationUnitId: true, DirectValidatorId: true },
    });

    if (employee.DirectValidatorId) {
      if (employee.DirectValidatorId === employeeId) return this.autoApprove(entryId, null, actorId, digest);
      const spec = await directValidatorSpec(this.prisma, employee.DirectValidatorId);
      const resolved = resolveApprovers(spec);
      return this.openStep(entryId, null, 1, employee.DirectValidatorId, null, actorId, resolved.all.filter((id) => id !== employee.DirectValidatorId && id !== employeeId), digest);
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
    if (!applicable) return this.autoApprove(entryId, pool.Id, actorId, digest);
    return this.openStep(entryId, pool.Id, applicable.member.StepOrder, applicable.approverId, applicable.member.Id, actorId, applicable.coApproverIds, digest);
  }

  private async autoApprove(entryId: string, poolId: string | null, actorId: string, digest?: NotificationDigest) {
    const current = await this.prisma.timeManualEntry.findUnique({
      where: { Id: entryId },
      select: { EntryType: true, FirstClockIn: true, LastClockOut: true },
    });
    // Incomplete : elle reste en attente, la completer la renvoie dans le circuit.
    if (current && isIncomplete(current.EntryType ?? '', current.FirstClockIn, current.LastClockOut)) {
      return this.prisma.timeManualEntry.update({
        where: { Id: entryId },
        data: { Status: 'Pending', ApprovalPoolId: poolId, CurrentApprovalStep: null, ModifiedAt: new Date() },
        include: INCLUDE,
      });
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      const entry = await tx.timeManualEntry.update({
        where: { Id: entryId },
        data: { Status: 'Approved', ApprovalPoolId: poolId, CurrentApprovalStep: null, RejectionReason: null, ValidatedById: actorId, ModifiedAt: new Date() },
        include: INCLUDE,
      });
      await tx.timeManualEntryHistory.create({ data: { EntryId: entryId, Action: 'APPROVE', ActorId: actorId, Comment: 'Approbation automatique' } });
      return entry;
    });
    if (digest) {
      digest.approved.set(updated.EmployeeId, (digest.approved.get(updated.EmployeeId) ?? 0) + 1);
      return updated;
    }
    await this.refreshDailyHours([updated.EmployeeId], keyOf(updated.Date), keyOf(updated.Date));
    await removeControl(this.prisma, updated.EmployeeId, keyOf(updated.Date), actorId, 'Saisie approuvée après le contrôle');
    await this.notify(updated.EmployeeId, 'Saisie de temps approuvée', `Votre saisie du ${keyOf(updated.Date)} est approuvée.`);
    return updated;
  }

  // Une saisie approuvee entre dans les heures travaillees : les heures du jour
  // sont recalculees tout de suite. Un echec ne remet pas la decision en cause
  // (le calcul T4 le rattrape).
  private async refreshDailyHours(employeeIds: string[], from: string, to: string) {
    try {
      await this.calculation.calculateDailyHours(from, to, {}, employeeIds);
    } catch (err) {
      this.logger.warn(`Heures du jour non recalculées : ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async openStep(
    entryId: string,
    poolId: string | null,
    step: number,
    approverId: string,
    poolMemberId: string | null,
    actorId: string,
    coApproverIds: string[] = [],
    digest?: NotificationDigest,
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
    if (digest) {
      digest.toValidate.set(approverId, (digest.toValidate.get(approverId) ?? 0) + 1);
      for (const id of coApproverIds) {
        const current = digest.coApprovers.get(id);
        digest.coApprovers.set(id, { primaryId: approverId, count: (current?.count ?? 0) + 1 });
      }
      return updated;
    }
    await this.notify(
      approverId,
      'Saisie de temps à valider',
      `${updated.employee.FullName} a saisi ${Number(updated.Hours)} h le ${keyOf(updated.Date)}.`,
      '/hr/time/validation',
    );
    await this.notifyCoApprovers(
      coApproverIds,
      approverId,
      'Saisie de temps à valider',
      `${updated.employee.FullName} a saisi ${Number(updated.Hours)} h le ${keyOf(updated.Date)} (en tant qu'intérimaire).`,
    );
    return updated;
  }

  // L'interimaire voit la saisie tout le temps, mais n'est prevenu que si le
  // validateur principal est en conge approuve (retour client du 12/11).
  private async notifyCoApprovers(coApproverIds: string[], primaryId: string, title: string, message: string) {
    if (coApproverIds.length === 0 || !(await isOnApprovedLeave(this.prisma, primaryId))) return;
    for (const id of coApproverIds) await this.notify(id, title, message, '/hr/time/validation');
  }

  private async notify(employeeId: string, title: string, message: string, href = '/my-space/time') {
    try {
      await this.notifications.create({ employeeId, type: 'system', title, message, href });
    } catch (err) {
      this.logger.warn(`Notification non envoyée : ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // ── Perimetre ─────────────────────────────────────────────────────────────

  // Employes pour qui la personne peut saisir : null = tout le monde (RH). Un
  // validateur : son equipe (et lui-meme avec TEMPS_SAISIR).
  private async scopeOf(actorId: string, permissions: Set<string>): Promise<Set<string> | null> {
    if (permissions.has('TEMPS_ACCES')) return null;
    const ids = permissions.has('TEMPS_VALIDER') ? await this.calculation.teamEmployeeIds(actorId) : [];
    return new Set(permissions.has('TEMPS_SAISIR') ? [...ids, actorId] : ids);
  }

  // Lecture : ses propres saisies et celles de son equipe.
  private async readableBase(actorId: string, permissions: Set<string>): Promise<Prisma.TimeManualEntryWhereInput> {
    if (permissions.has('TEMPS_ACCES')) return {};
    const team = permissions.has('TEMPS_VALIDER') ? await this.calculation.teamEmployeeIds(actorId) : [];
    return { EmployeeId: { in: [...team, actorId] } };
  }

  // Employes proposes dans les fenetres de saisie.
  async entryEmployees(actorId: string, permissions: Set<string>) {
    const scope = await this.scopeOf(actorId, permissions);
    const rows = await this.prisma.employee.findMany({
      where: { IsDeleted: false, IsSystem: false, Status: { not: 'Inactive' }, ...(scope ? { Id: { in: [...scope] } } : {}) },
      select: { Id: true, FullName: true, EmployeeNumber: true, organizationUnit: { select: { Name: true } } },
      orderBy: [{ FullName: 'asc' }, { Id: 'asc' }],
    });
    return rows.map((e) => ({ Id: e.Id, FullName: e.FullName, EmployeeNumber: e.EmployeeNumber, EntityName: e.organizationUnit?.Name ?? null }));
  }

  // Une saisie de travail ne peut pas en chevaucher une autre du meme jour.
  private async assertNoOverlap(employeeId: string, dateKey: string, slot: Slot, exceptId?: string) {
    if (!isWorkType(slot.entryType)) return;
    // La veille et le lendemain aussi : un poste de nuit deborde sur le jour suivant.
    const others = await this.prisma.timeManualEntry.findMany({
      where: {
        EmployeeId: employeeId,
        Date: { gte: shiftDays(dateKey, -1), lte: shiftDays(dateKey, 1) },
        EntryType: { in: WORK_ENTRY_TYPES },
        Status: { in: ['Pending', 'Approved'] },
        ...(exceptId ? { Id: { not: exceptId } } : {}),
      },
      select: { Date: true, EntryType: true, FirstClockIn: true, LastClockOut: true, Hours: true },
    });
    const clash = (others ?? []).find((o) => overlapsAcross(slot, dateKey, toSlot(o), keyOf(o.Date)));
    if (clash) {
      const day = keyOf(clash.Date);
      const which = day === dateKey ? 'une saisie existante de ce jour' : `la saisie du ${frDate(day)}`;
      throw new BadRequestException(`Chevauche ${which} (${slotLabel(toSlot(clash))}) : modifiez-la ou annulez-la`);
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
    const employeeId = dto.EmployeeId ?? actorId;
    const scope = await this.scopeOf(actorId, permissions);
    if (scope && !scope.has(employeeId)) {
      throw new ForbiddenException(
        employeeId === actorId ? 'Vous ne pouvez pas saisir vos temps' : 'Saisie pour un autre employé réservée au RH et à son manager',
      );
    }
    const target = await this.prisma.employee.findFirst({ where: { Id: employeeId, IsDeleted: false }, select: { Id: true } });
    if (!target) throw new NotFoundException('Employé introuvable');

    // Delai du RH pour qui saisit pour un autre (RH ou manager).
    this.assertWindow(dto.Date.slice(0, 10), permissions.has('TEMPS_ACCES') || employeeId !== actorId);
    await assertWeekOpen(this.prisma, employeeId, dto.Date.slice(0, 10));
    await this.assertNoDuplicate(employeeId, dto.Date.slice(0, 10), dto.EntryType);
    const times = resolveTimes(dto.Date.slice(0, 10), dto.Hours, dto.StartTime, dto.EndTime);
    await this.assertNoOverlap(employeeId, dto.Date.slice(0, 10), slotFrom(dto.EntryType, times));

    return this.createOne(
      { employeeId, date: dto.Date, times, entryType: dto.EntryType, comments: dto.Comments },
      actorId,
    );
  }

  private async createOne(
    data: { employeeId: string; date: string; times: ReturnType<typeof resolveTimes>; entryType: string; comments?: string; source?: string },
    actorId: string,
    digest?: NotificationDigest,
  ) {
    const entry = await this.prisma.$transaction(async (tx) => {
      const created = await tx.timeManualEntry.create({
        data: {
          EmployeeId: data.employeeId,
          SubmittedById: actorId,
          Date: toDate(data.date),
          Hours: data.times.hours,
          FirstClockIn: data.times.clockIn,
          LastClockOut: data.times.clockOut,
          EntryType: data.entryType,
          Comments: data.comments,
          Source: data.source ?? 'Manual',
          Status: 'Pending',
        },
      });
      await tx.timeManualEntryHistory.create({ data: { EntryId: created.Id, Action: 'CREATE', ActorId: actorId } });
      return created;
    });
    try {
      return await this.route(entry.Id, data.employeeId, actorId, digest);
    } catch (err) {
      // Pas de circuit configure : on n'abandonne pas une saisie orpheline.
      await this.prisma.timeManualEntryHistory.deleteMany({ where: { EntryId: entry.Id } });
      await this.prisma.timeManualEntry.delete({ where: { Id: entry.Id } });
      throw err;
    }
  }

  // ── Saisie en lot ─────────────────────────────────────────────────────────

  // Le RH (ou un manager pour son equipe) declare le meme element pour plusieurs
  // employes sur une periode. Les journees impossibles sont ecartees avec leur
  // motif ; chaque journee retenue devient une saisie normale, qui suit le
  // circuit de validation de l'employe. Avec DryRun, rien n'est cree et la liste
  // des journees retenues est renvoyee pour etre ajustee puis envoyee en lignes.
  async createBatch(dto: CreateTimeEntryBatchDto, actorId: string, permissions: Set<string>) {
    const from = dto.From.slice(0, 10);
    const to = dto.To.slice(0, 10);
    if (to < from) throw new BadRequestException('La date de fin doit être après la date de début');
    if (datesInRange(from, to).length > BATCH_MAX_DAYS) {
      throw new BadRequestException(`La période ne peut pas dépasser ${BATCH_MAX_DAYS} jours`);
    }
    // Un panier ou une permanence compte pour 1 par jour, sans horaires.
    const oncePerDay = dto.EntryType === 'panier' || dto.EntryType === 'permanence';
    const timesOn = (dateKey: string) =>
      oncePerDay ? resolveTimes(dateKey, 1) : resolveTimes(dateKey, dto.Hours, dto.StartTime, dto.EndTime);
    timesOn(from); // horaires invalides : refus avant tout traitement

    const ids = [...new Set(dto.EmployeeIds)];
    const scope = await this.scopeOf(actorId, permissions);
    if (scope && ids.some((id) => !scope.has(id))) throw new ForbiddenException("Un des employés choisis n'est pas dans votre équipe");
    const employees = await this.prisma.employee.findMany({
      where: { Id: { in: ids }, IsDeleted: false, IsSystem: false },
      select: {
        Id: true,
        FullName: true,
        EmployeeNumber: true,
        Status: true,
        HireDate: true,
        TerminationDate: true,
        OrganizationUnitId: true,
        DirectValidatorId: true,
      },
      orderBy: { FullName: 'asc' },
    });
    if (employees.length !== ids.length) throw new NotFoundException('Un des employés choisis est introuvable');

    const poolByUnit = new Map<string, boolean>();
    for (const e of employees) {
      if (e.DirectValidatorId || poolByUnit.has(e.OrganizationUnitId)) continue;
      const pool = await this.approvalPools.findApplicablePool(e.OrganizationUnitId, ENTITY_TYPE);
      poolByUnit.set(e.OrganizationUnitId, !!pool && pool.members.length > 0);
    }

    const [holidays, leaves, declared] = await Promise.all([
      this.calculation.holidayKeysByEmployee(ids, from, to),
      this.prisma.leaveRequest.findMany({
        where: {
          EmployeeId: { in: ids },
          Status: { in: TAKEN_LEAVE_STATUSES },
          IsDeleted: false,
          StartDate: { lte: toDate(to) },
          EndDate: { gte: toDate(from) },
        },
        select: { EmployeeId: true, StartDate: true, EndDate: true, StartPeriod: true, EndPeriod: true },
      }),
      this.prisma.timeManualEntry.findMany({
        where: {
          EmployeeId: { in: ids },
          EntryType: dto.EntryType,
          Status: { in: ['Pending', 'Approved'] },
          Date: { gte: toDate(from), lte: toDate(to) },
        },
        select: { EmployeeId: true, Date: true },
      }),
    ]);

    const locked = await validatedWeeks(this.prisma, ids, from, to);
    const lockedDays = new Set<string>();
    for (const e of employees) for (const d of datesInRange(from, to)) if (locked.has(weekKey(e.Id, d))) lockedDays.add(`${e.Id}|${d}`);
    const plan = planBatch({
      lockedDays,
      employees: employees.map((e) => ({
        id: e.Id,
        isInactive: e.Status === 'Inactive',
        hireDate: e.HireDate ? keyOf(e.HireDate) : null,
        terminationDate: e.TerminationDate ? keyOf(e.TerminationDate) : null,
        hasRoute: !!e.DirectValidatorId || poolByUnit.get(e.OrganizationUnitId) === true,
      })),
      from,
      to,
      weekdays: dto.Weekdays,
      includeHolidays: dto.IncludeHolidays ?? false,
      holidays,
      leaves: leaves.map((l) => ({
        employeeId: l.EmployeeId,
        start: keyOf(l.StartDate),
        end: keyOf(l.EndDate),
        startPeriod: l.StartPeriod,
        endPeriod: l.EndPeriod,
      })),
      // Un panier ou une permanence : une fois par jour. Une saisie de travail peut
      // s'ajouter a une autre le meme jour ; le chevauchement est controle ligne par ligne.
      declared: new Set(oncePerDay ? declared.map((d) => declaredKey(d.EmployeeId, keyOf(d.Date))) : []),
      today: todayKey(),
    });
    if (plan.toCreate.length > BATCH_MAX_ENTRIES) {
      throw new BadRequestException(
        `${plan.toCreate.length} saisies demandées : réduisez la période ou le nombre d'employés (${BATCH_MAX_ENTRIES} au maximum)`,
      );
    }
    if (dto.DryRun) return this.batchReport(employees, plan, true, 0, []);

    // Memes controles que l'envoi en lignes : une journee en conflit est ecartee.
    const sent = await this.createLines(
      {
        Lines: plan.toCreate.map((item) => ({
          EmployeeId: item.employeeId,
          Date: item.dateKey,
          EntryType: dto.EntryType,
          ...(oncePerDay ? {} : { StartTime: dto.StartTime, EndTime: dto.EndTime, Hours: dto.Hours }),
          Comments: dto.Comments,
        })),
      },
      actorId,
      permissions,
    );
    const failures = sent.Lines.filter((l) => l.Action !== 'create').map((l) => ({
      employeeId: plan.toCreate[l.Index]!.employeeId,
      dateKey: plan.toCreate[l.Index]!.dateKey,
      message: l.Message ?? 'Non créée',
    }));
    return this.batchReport(employees, plan, false, sent.Created, failures);
  }

  // ── Saisie par lignes (lot ajuste ou fichier importe) ────────────────────

  // Chaque ligne est un employe, un jour et une periode. Une ligne qui chevauche
  // une saisie existante n'est creee que si le choix est fait (OnConflict) : rien
  // n'est ecrase en silence. Un manager ne traite que les lignes de son equipe.
  async createLines(dto: CreateTimeEntryLinesDto, actorId: string, permissions: Set<string>) {
    const scope = await this.scopeOf(actorId, permissions);
    const ids = [...new Set(dto.Lines.map((l) => l.EmployeeId).filter((v): v is string => !!v))];
    const numbers = [...new Set(dto.Lines.map((l) => l.EmployeeNumber?.trim()).filter((v): v is string => !!v))];
    const employees = await this.prisma.employee.findMany({
      where: { IsDeleted: false, IsSystem: false, OR: [{ Id: { in: ids } }, { EmployeeNumber: { in: numbers } }] },
      select: {
        Id: true,
        FullName: true,
        EmployeeNumber: true,
        Status: true,
        HireDate: true,
        TerminationDate: true,
        OrganizationUnitId: true,
        DirectValidatorId: true,
      },
    });
    const poolByUnit = new Map<string, boolean>();
    for (const e of employees) {
      if (e.DirectValidatorId || poolByUnit.has(e.OrganizationUnitId)) continue;
      const pool = await this.approvalPools.findApplicablePool(e.OrganizationUnitId, ENTITY_TYPE);
      poolByUnit.set(e.OrganizationUnitId, !!pool && pool.members.length > 0);
    }
    const byId = new Map(employees.map((e) => [e.Id.toLowerCase(), e]));
    const byNumber = new Map(employees.map((e) => [e.EmployeeNumber.toLowerCase(), e]));

    const lines: PlannedLine[] = dto.Lines.map((l) => {
      const found = l.EmployeeId ? byId.get(l.EmployeeId.toLowerCase()) : byNumber.get((l.EmployeeNumber ?? '').trim().toLowerCase());
      const dateKey = (l.Date ?? '').slice(0, 10);
      const line: PlannedLine = {
        employee: found
          ? {
              id: found.Id,
              name: found.FullName,
              number: found.EmployeeNumber,
              isInactive: found.Status === 'Inactive',
              hireDate: found.HireDate ? keyOf(found.HireDate) : null,
              terminationDate: found.TerminationDate ? keyOf(found.TerminationDate) : null,
              hasRoute: !!found.DirectValidatorId || poolByUnit.get(found.OrganizationUnitId) === true,
            }
          : null,
        dateKey,
        slot: null,
        onConflict: l.OnConflict,
      };
      try {
        line.slot = slotFrom(l.EntryType, lineTimes(dateKey, l));
      } catch (err) {
        line.invalid = err instanceof Error ? err.message : String(err);
      }
      return line;
    });

    const employeeIds = employees.map((e) => e.Id);
    const dates = lines.map((l) => l.dateKey).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
    const from = dates[0] ?? todayKey();
    const to = dates[dates.length - 1] ?? from;
    // Un jour de plus de chaque cote : les postes de nuit passent minuit.
    const before = keyOf(shiftDays(from, -1));
    const after = keyOf(shiftDays(to, 1));
    const range = { gte: toDate(before), lte: toDate(after) };
    const [existing, punches, leaves] = await Promise.all([
      this.prisma.timeManualEntry.findMany({
        where: { EmployeeId: { in: employeeIds }, Status: { in: ['Pending', 'Approved'] }, Date: range },
        select: { Id: true, EmployeeId: true, Date: true, EntryType: true, Status: true, FirstClockIn: true, LastClockOut: true, Hours: true },
      }),
      this.calculation.loadPunchSpans(before, after, employeeIds),
      this.prisma.leaveRequest.findMany({
        where: {
          EmployeeId: { in: employeeIds },
          Status: { in: TAKEN_LEAVE_STATUSES },
          IsDeleted: false,
          StartDate: { lte: toDate(to) },
          EndDate: { gte: toDate(from) },
        },
        select: { EmployeeId: true, StartDate: true, EndDate: true, StartPeriod: true, EndPeriod: true },
      }),
    ]);
    const leaveDays = new Set<string>();
    for (const l of leaves) {
      const leave = { employeeId: l.EmployeeId, start: keyOf(l.StartDate), end: keyOf(l.EndDate), startPeriod: l.StartPeriod, endPeriod: l.EndPeriod };
      for (const d of dates) if (isFullLeaveDay(leave, d)) leaveDays.add(`${l.EmployeeId}|${d}`);
    }

    const locked = await validatedWeeks(this.prisma, employeeIds, from, to);
    const lockedDays = new Set<string>();
    for (const e of employees) for (const d of dates) if (locked.has(weekKey(e.Id, d))) lockedDays.add(`${e.Id}|${d}`);
    const results = planLines({
      lines,
      scope,
      lockedDays,
      actorId,
      today: todayKey(),
      leaveDays,
      existing: existing.map(
        (e): ExistingEntry => ({
          ...toSlot(e),
          id: e.Id,
          employeeId: e.EmployeeId,
          dateKey: keyOf(e.Date),
          status: e.Status as ExistingEntry['status'],
        }),
      ),
      // Un passage manquant n'avertit pas.
      punches: punches
        .filter((p) => !p.missing)
        .map((p) => ({
          employeeId: p.employeeId,
          dateKey: p.dateKey,
          start: minutesOf(p.first)!,
          end: exitMinutes(p.first, p.last)!,
        })),
    });
    if (dto.DryRun) return this.linesReport(lines, results, scope, true);

    const digest: NotificationDigest = { toValidate: new Map(), coApprovers: new Map(), approved: new Map() };
    for (const result of results) {
      if (result.action !== 'create' && result.action !== 'replace') continue;
      const source = dto.Lines[result.index]!;
      const line = lines[result.index]!;
      try {
        await this.createOne(
          {
            employeeId: line.employee!.id,
            date: line.dateKey,
            times: lineTimes(line.dateKey, source),
            entryType: source.EntryType,
            comments: source.Comments,
            source: dto.Source,
          },
          actorId,
          digest,
        );
        // La nouvelle saisie existe : les anciennes peuvent etre retirees.
        for (const id of result.replaceIds) await this.retire(id, actorId, 'Remplacée par une nouvelle saisie');
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.warn(`Saisie par lignes : ligne ${result.index + 1} non créée : ${message}`);
        result.action = 'error';
        result.message = err instanceof HttpException ? message : 'Erreur technique';
      }
    }
    if (digest.approved.size > 0) await this.refreshDailyHours([...digest.approved.keys()], from, to);
    await this.sendDigest(digest, from, to);
    return this.linesReport(lines, results, scope, false);
  }

  private linesReport(lines: PlannedLine[], results: LineResult[], scope: Set<string> | null, dryRun: boolean) {
    return {
      DryRun: dryRun,
      Created: dryRun ? 0 : results.filter((r) => r.action === 'create' || r.action === 'replace').length,
      Lines: results.map((r) => {
        const employee = lines[r.index]!.employee;
        // Hors perimetre : aucun nom n'est renvoye.
        const visible = employee && (!scope || scope.has(employee.id)) ? employee : null;
        return {
          Index: r.index,
          Action: r.action,
          Message: r.message ?? null,
          Warnings: r.warnings,
          CanReplace: r.canReplace,
          EmployeeId: visible?.id ?? null,
          EmployeeName: visible?.name ?? null,
          EmployeeNumber: visible?.number ?? null,
        };
      }),
    };
  }

  // Retire une saisie en attente (annulation ou remplacement), avec sa decision.
  private async retire(id: string, actorId: string, comment: string) {
    return this.prisma.$transaction(async (tx) => {
      await tx.approvalDecision.updateMany({
        where: { EntityType: ENTITY_TYPE, EntityId: id, Decision: 'Pending' },
        data: { Decision: 'Cancelled', DecidedAt: new Date() },
      });
      await tx.timeManualEntryHistory.create({ data: { EntryId: id, Action: 'UPDATE', ActorId: actorId, Comment: comment } });
      return tx.timeManualEntry.update({
        where: { Id: id },
        data: { Status: 'Cancelled', CurrentApprovalStep: null, ModifiedAt: new Date() },
        include: INCLUDE,
      });
    });
  }

  private batchReport(
    employees: { Id: string; FullName: string; EmployeeNumber: string }[],
    plan: BatchPlan,
    dryRun: boolean,
    created: number,
    failures: { employeeId: string; dateKey: string; message: string }[],
  ) {
    return {
      DryRun: dryRun,
      Planned: plan.toCreate.length,
      Created: created,
      // Journees retenues : l'ecran les propose a l'ajustement avant l'envoi en lignes.
      Lines: plan.toCreate.map((l) => ({ EmployeeId: l.employeeId, Date: l.dateKey })),
      Employees: employees.map((e) => {
        const skipped = new Map<string, string[]>();
        const add = (reason: string, dateKey: string) => skipped.set(reason, [...(skipped.get(reason) ?? []), dateKey]);
        for (const s of plan.skipped) if (s.employeeId === e.Id) add(BATCH_SKIP_LABELS[s.reason], s.dateKey);
        for (const f of failures) if (f.employeeId === e.Id) add(f.message, f.dateKey);
        const planned = plan.toCreate.filter((c) => c.employeeId === e.Id).length;
        return {
          EmployeeId: e.Id,
          FullName: e.FullName,
          EmployeeNumber: e.EmployeeNumber,
          Planned: planned - failures.filter((f) => f.employeeId === e.Id).length,
          Skipped: Array.from(skipped, ([Reason, Dates]) => ({ Reason, Dates })),
        };
      }),
    };
  }

  private async sendDigest(digest: NotificationDigest, from: string, to: string) {
    const period = `saisie en lot du ${frDate(from)} au ${frDate(to)}`;
    for (const [id, count] of digest.toValidate) {
      await this.notify(id, 'Saisies de temps à valider', `${count} saisie(s) à valider (${period}).`, '/hr/time/validation');
    }
    for (const [id, { primaryId, count }] of digest.coApprovers) {
      await this.notifyCoApprovers([id], primaryId, 'Saisies de temps à valider', `${count} saisie(s) à valider (${period}, en tant qu'intérimaire).`);
    }
    for (const [id, count] of digest.approved) {
      await this.notify(id, 'Saisies de temps approuvées', `${count} saisie(s) approuvée(s) (${period}).`);
    }
  }

  private async findRaw(id: string) {
    const entry = await this.prisma.timeManualEntry.findUnique({ where: { Id: id }, include: INCLUDE });
    if (!entry) throw new NotFoundException(`Saisie ${id} introuvable`);
    return entry;
  }

  // La personne concernee, celle qui a saisi, son manager ou le RH.
  private async assertCanEdit(entry: { EmployeeId: string; SubmittedById: string }, actorId: string, permissions: Set<string>) {
    if (permissions.has('TEMPS_ACCES') || entry.EmployeeId === actorId || entry.SubmittedById === actorId) return;
    if (permissions.has('TEMPS_VALIDER') && (await this.calculation.teamEmployeeIds(actorId)).includes(entry.EmployeeId)) return;
    throw new ForbiddenException('Vous ne pouvez modifier que vos saisies et celles de votre équipe');
  }

  // Modification d'une saisie en attente ou refusee : elle repart dans le circuit.
  async update(id: string, dto: UpdateTimeEntryDto, actorId: string, permissions: Set<string>) {
    const existing = await this.findRaw(id);
    await this.assertCanEdit(existing, actorId, permissions);
    const isHr = permissions.has('TEMPS_ACCES') || existing.EmployeeId !== actorId;
    if (existing.Status !== 'Pending' && existing.Status !== 'Rejected') {
      throw new BadRequestException(`Une saisie "${existing.Status}" ne peut plus être modifiée`);
    }
    const newDate = dto.Date ? dto.Date.slice(0, 10) : keyOf(existing.Date);
    const newType = dto.EntryType ?? existing.EntryType ?? 'mission';
    this.assertWindow(keyOf(existing.Date), isHr);
    this.assertWindow(newDate, isHr);
    await assertWeekOpen(this.prisma, existing.EmployeeId, keyOf(existing.Date));
    await assertWeekOpen(this.prisma, existing.EmployeeId, newDate);
    await this.assertNoDuplicate(existing.EmployeeId, newDate, newType, id);
    // Horaires : s'ils sont modifies, la duree est recalculee ; si seule la duree
    // change, les anciens horaires ne correspondent plus et sont retires.
    const touchesTimes = dto.StartTime !== undefined || dto.EndTime !== undefined || dto.Hours !== undefined;
    const times = touchesTimes ? resolveTimes(newDate, dto.Hours, dto.StartTime, dto.EndTime) : null;
    const slot = times
      ? slotFrom(newType, times)
      : toSlot({ EntryType: newType, FirstClockIn: existing.FirstClockIn, LastClockOut: existing.LastClockOut, Hours: existing.Hours });
    await this.assertNoOverlap(existing.EmployeeId, newDate, slot, id);

    await this.prisma.$transaction(async (tx) => {
      await tx.approvalDecision.updateMany({
        where: { EntityType: ENTITY_TYPE, EntityId: id, Decision: 'Pending' },
        data: { Decision: 'Cancelled', DecidedAt: new Date() },
      });
      await tx.timeManualEntry.update({
        where: { Id: id },
        data: {
          Date: dto.Date ? toDate(dto.Date) : undefined,
          ...(times ? { Hours: times.hours, FirstClockIn: times.clockIn, LastClockOut: times.clockOut } : {}),
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
    await this.assertCanEdit(existing, actorId, permissions);
    if (existing.Status !== 'Pending') throw new BadRequestException('Seule une saisie en attente peut être annulée');
    await assertWeekOpen(this.prisma, existing.EmployeeId, keyOf(existing.Date));
    return this.retire(id, actorId, 'Annulée');
  }

  // ── Decision ──────────────────────────────────────────────────────────────

  // Validateur prevu de l'etape ou son interimaire (membre de pool, ou validateur direct).
  private async canActOn(
    decision: { ApprovalPoolMemberId: string | null; DirectValidatorEmployeeId: string | null; ValidatedByEmployeeId: string },
    employeeId: string,
  ): Promise<boolean> {
    if (decision.ValidatedByEmployeeId === employeeId) return true;
    if (decision.ApprovalPoolMemberId) {
      const member = await this.prisma.approvalPoolMember.findUnique({
        where: { Id: decision.ApprovalPoolMemberId },
        select: { EmployeeId: true, InterimEmployeeId: true },
      });
      return !!member && canDecide(resolveApprovers(member), employeeId);
    }
    const validatorId = decision.DirectValidatorEmployeeId ?? decision.ValidatedByEmployeeId;
    return canDecide(resolveApprovers(await directValidatorSpec(this.prisma, validatorId)), employeeId);
  }

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
    if (!decision || !(await this.canActOn(decision, approverId))) {
      throw new ForbiddenException("Vous n'êtes pas le validateur actuel de cette saisie");
    }
  }

  // Ajustement des heures par le validateur courant (ex : 1 h devient 3 h) : la
  // saisie reste en attente, au meme point du circuit, et sa decision suit. Elle
  // ne repart PAS au debut comme une modification de l'employe. L'ancienne et la
  // nouvelle duree sont gardees dans l'historique, avec le motif.
  async adjust(id: string, dto: AdjustTimeEntryDto, actorId: string, permissions: Set<string>) {
    const existing = await this.findRaw(id);
    await this.assertIsCurrentApprover(existing, actorId, permissions.has('TEMPS_ACCES'));
    await assertWeekOpen(this.prisma, existing.EmployeeId, keyOf(existing.Date));
    if (existing.EntryType === 'panier' || existing.EntryType === 'permanence') {
      throw new BadRequestException('Cette saisie compte pour 1 par jour : il n\'y a pas d\'heures à ajuster');
    }
    const times = resolveTimes(keyOf(existing.Date), dto.Hours, dto.StartTime, dto.EndTime);
    const before = Number(existing.Hours);
    const sameClock =
      !!times.clockIn === !!existing.FirstClockIn &&
      (!times.clockIn || (times.clockIn.getTime() === existing.FirstClockIn?.getTime() && times.clockOut?.getTime() === existing.LastClockOut?.getTime()));
    if (times.hours === before && sameClock) throw new BadRequestException('Aucune modification des heures');

    const note = describeAdjustment(before, times.hours, dto.StartTime, dto.EndTime, dto.Comment);
    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.timeManualEntryHistory.create({ data: { EntryId: id, Action: 'ADJUST', ActorId: actorId, Comment: note } });
      return tx.timeManualEntry.update({
        where: { Id: id },
        data: { Hours: times.hours, FirstClockIn: times.clockIn, LastClockOut: times.clockOut, ModifiedAt: new Date() },
        include: INCLUDE,
      });
    });
    await this.notify(existing.EmployeeId, 'Saisie de temps ajustée', `Vos heures du ${keyOf(existing.Date)} ont été ajustées : ${note}`);
    return updated;
  }

  async approve(id: string, dto: DecideTimeEntryDto, approverId: string, permissions: Set<string>) {
    const existing = await this.findRaw(id);
    await this.assertIsCurrentApprover(existing, approverId, permissions.has('TEMPS_ACCES'));
    if (isIncomplete(existing.EntryType ?? '', existing.FirstClockIn, existing.LastClockOut)) {
      throw new BadRequestException("Saisie incomplète : renseignez l'heure d'entrée et l'heure de sortie avant d'approuver");
    }
    await assertWeekOpen(this.prisma, existing.EmployeeId, keyOf(existing.Date));
    const pending = await this.prisma.approvalDecision.findFirst({
      where: { EntityType: ENTITY_TYPE, EntityId: id, StepOrder: existing.CurrentApprovalStep as number, Decision: 'Pending' },
    });
    if (!pending) throw new BadRequestException('Aucune décision en attente pour cette étape');

    let next: { member: { Id: string; StepOrder: number; EmployeeId: string; InterimEmployeeId: string | null }; approverId: string; coApproverIds: string[] } | undefined;
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
      await this.notifyCoApprovers(next.coApproverIds, next.approverId, 'Saisie de temps à valider', `${existing.employee.FullName} : saisie du ${keyOf(existing.Date)} (en tant qu'intérimaire).`);
    } else {
      await this.refreshDailyHours([existing.EmployeeId], keyOf(existing.Date), keyOf(existing.Date));
      await removeControl(this.prisma, existing.EmployeeId, keyOf(existing.Date), approverId, 'Saisie approuvée après le contrôle');
      await this.notify(existing.EmployeeId, 'Saisie de temps approuvée', `Votre saisie du ${keyOf(existing.Date)} est approuvée.`);
    }
    return updated;
  }

  async reject(id: string, dto: DecideTimeEntryDto, approverId: string, permissions: Set<string>) {
    if (!dto.Comment || dto.Comment.trim().length === 0) throw new BadRequestException('Le motif du refus est requis');
    const existing = await this.findRaw(id);
    await this.assertIsCurrentApprover(existing, approverId, permissions.has('TEMPS_ACCES'));
    await assertWeekOpen(this.prisma, existing.EmployeeId, keyOf(existing.Date));
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
      ...(q.Search?.trim()
        ? {
            OR: [
              { employee: { FullName: { contains: q.Search.trim() } } },
              { employee: { EmployeeNumber: { contains: q.Search.trim() } } },
              { Comments: { contains: q.Search.trim() } },
            ],
          }
        : {}),
      ...(q.From || q.To ? { Date: { ...(q.From ? { gte: toDate(q.From) } : {}), ...(q.To ? { lte: toDate(q.To) } : {}) } } : {}),
    };
  }

  private async page(where: Prisma.TimeManualEntryWhereInput, q: QueryTimeEntriesDto) {
    const page = q.Page ?? 1;
    const limit = q.Limit ?? 50;
    const [data, total, sum] = await Promise.all([
      this.prisma.timeManualEntry.findMany({ where, include: INCLUDE, orderBy: [{ Date: 'desc' }, { CreatedAt: 'desc' }], skip: (page - 1) * limit, take: limit }),
      this.prisma.timeManualEntry.count({ where }),
      this.prisma.timeManualEntry.aggregate({ where, _sum: { Hours: true } }),
    ]);
    // `hours` : total des heures de TOUTES les saisies du filtre (pas seulement la page).
    return { data, total, hours: Math.round(Number(sum._sum.Hours ?? 0) * 100) / 100, page, limit, totalPages: Math.ceil(total / limit) };
  }

  findMine(employeeId: string, q: QueryTimeEntriesDto) {
    return this.page(this.buildWhere({ ...q, EmployeeId: undefined }, { EmployeeId: employeeId }), q);
  }

  // Toutes les saisies pour le RH ; les siennes et celles de son equipe pour un manager.
  async findAll(q: QueryTimeEntriesDto, me: string, permissions: Set<string>) {
    return this.page({ AND: [await this.readableBase(me, permissions), this.buildWhere(q)] }, q);
  }

  // Saisies en attente de MA decision (ou toutes pour le RH).
  async findPendingForMe(approverId: string, permissions: Set<string>, q: QueryTimeEntriesDto) {
    if (permissions.has('TEMPS_ACCES')) return this.page(this.buildWhere({ ...q, Status: 'Pending' }), q);
    const decisions = await this.prisma.approvalDecision.findMany({
      where: {
        EntityType: ENTITY_TYPE,
        Decision: 'Pending',
        OR: [
          { ValidatedByEmployeeId: approverId },
          { approvalPoolMember: { InterimEmployeeId: approverId } },
          { directValidatorEmployee: { ValidatorInterimId: approverId } },
        ],
      },
      select: { EntityId: true },
    });
    return this.page(this.buildWhere({ ...q, Status: 'Pending' }, { Id: { in: decisions.map((d) => d.EntityId) } }), q);
  }

  // Compteurs du bandeau "Resume" de l'ecran Saisies : calcules en base sur toutes
  // les saisies du perimetre (toutes pour le RH, les miennes sinon) et les
  // memes filtres que la liste, hors statut.
  async summary(me: string, permissions: Set<string>, q: QueryTimeEntriesDto) {
    const where = { AND: [await this.readableBase(me, permissions), this.buildWhere({ ...q, Status: undefined })] };
    const groups = await this.prisma.timeManualEntry.groupBy({ by: ['Status'], where, _count: { _all: true }, _sum: { Hours: true } });
    const count = (st: string) => groups.find((g) => g.Status === st)?._count._all ?? 0;
    const hours = (st: string) => Number(groups.find((g) => g.Status === st)?._sum.Hours ?? 0);
    return {
      total: groups.reduce((n, g) => n + g._count._all, 0),
      pending: count('Pending'),
      approved: count('Approved'),
      rejected: count('Rejected'),
      cancelled: count('Cancelled'),
      // Heures a prendre en compte : en attente ou approuvees.
      hours: Math.round((hours('Pending') + hours('Approved')) * 100) / 100,
    };
  }

  // Saisies que j'ai deja traitees (approuvees ou refusees par moi) ; le RH voit
  // toutes les saisies deja decidees. Alimente l'onglet "Traitees" de la validation.
  async findProcessed(approverId: string, permissions: Set<string>, q: QueryTimeEntriesDto) {
    if (permissions.has('TEMPS_ACCES')) {
      return this.page(this.buildWhere({ ...q, Status: undefined }, { Status: { in: ['Approved', 'Rejected'] } }), q);
    }
    const acts = await this.prisma.timeManualEntryHistory.findMany({
      where: { ActorId: approverId, Action: { in: ['APPROVE', 'REJECT'] } },
      select: { EntryId: true },
    });
    const ids = [...new Set(acts.map((a) => a.EntryId))];
    return this.page(this.buildWhere({ ...q, Status: undefined }, { Id: { in: ids } }), q);
  }

  async history(id: string, actorId: string, permissions: Set<string>) {
    const entry = await this.findRaw(id);
    const mine = entry.EmployeeId === actorId || entry.SubmittedById === actorId;
    if (!mine && !permissions.has('TEMPS_ACCES') && !permissions.has('TEMPS_VALIDER')) throw new ForbiddenException();
    return this.prisma.timeManualEntryHistory.findMany({ where: { EntryId: id }, orderBy: { CreatedAt: 'asc' } });
  }
}

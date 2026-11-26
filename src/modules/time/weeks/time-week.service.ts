import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { TimeCalculationService, type Schedule } from '../calculation/time-calculation.service';
import {
  DayHours,
  addDays,
  computeDailyHours,
  computeOvertimeLines,
  computePanierDays,
  longestContinuousHours,
  mondayOf,
  permanenceAmount,
  round2,
  weeklyOvertimeByDay,
} from '../calculation/overtime-engine';
import {
  DayPunch,
  FrozenDay,
  intervalOf,
  isIncompletePunch,
  parseJson,
  punchFromDates,
  samePunch,
  sortPunches,
} from '../calculation/day-punches';
import { WORK_ENTRY_TYPES } from '../calculation/work-records';
import { frShort, removeControl } from './week-lock';
import type { SaveWeekDto, WeekDayDto, WeekListQueryDto } from './time-week.dto';

export type WeekStatus = 'Open' | 'Controlled' | 'Validated';

const toDate = (key: string) => new Date(`${key}T00:00:00Z`);
const keyOf = (d: Date) => d.toISOString().slice(0, 10);
const todayKey = () => new Date().toISOString().slice(0, 10);
const TAKEN_LEAVE_STATUSES = ['Approved', 'Registered', 'Done', 'Regularized'];

// Numero de semaine ISO (la semaine 1 contient le premier jeudi de l'annee).
export function isoWeekNumber(monday: string): number {
  const thursday = toDate(addDays(monday, 3));
  const firstDay = Date.UTC(thursday.getUTCFullYear(), 0, 1);
  return Math.floor((thursday.getTime() - firstDay) / (7 * 86_400_000)) + 1;
}

export interface WeekDay {
  date: string;
  schedule: string | null;
  holiday: boolean;
  leave: string | null;
  punches: (DayPunch & { pending: boolean })[];
  extraHours: number;
  // null : jour non compte (pas d'horaire et jours non prevus ignores).
  worked: number | null;
  overtime: number;
  panier: boolean;
  permanence: boolean;
  corrected: boolean;
  incomplete: boolean;
  pendingEntryIds: string[];
}

export interface ComputedWeek {
  employeeId: string;
  status: WeekStatus;
  isCadre: boolean;
  controlledById: string | null;
  controlledAt: Date | null;
  validatedById: string | null;
  validatedAt: Date | null;
  days: WeekDay[];
  totals: { worked: number; overtime: number; hs130: number; hs150: number; night: number; holiday: number; panier: number; permanenceAmount: number };
}

// Pointages envoyes par l'ecran pour un jour : controles, puis rattaches a leur
// origine (une paire inchangee la garde, une paire nouvelle est "corrigee").
export function correctedPunches(dateKey: string, sent: NonNullable<WeekDayDto['Punches']>, current: DayPunch[]): DayPunch[] {
  const label = frShort(dateKey);
  const punches = sortPunches(
    sent
      .filter((p) => p.Start || p.End)
      .map((p) => {
        const punch: DayPunch = { start: p.Start ?? null, end: p.End ?? null, nextDay: !!p.NextDay && !!p.End, source: 'Corrected' };
        if (punch.start && punch.end && !punch.nextDay && punch.end <= punch.start) {
          throw new BadRequestException(`${label} : la sortie doit être après l'entrée (ou à saisir en sortie du lendemain)`);
        }
        const same = current.find((c) => samePunch(c, punch));
        return same ? { ...punch, source: same.source } : punch;
      }),
  );
  const intervals = punches.map((p) => intervalOf(p, dateKey)).filter((i) => i !== null);
  for (let i = 1; i < intervals.length; i++) {
    if (intervals[i]!.start < intervals[i - 1]!.end) throw new BadRequestException(`${label} : deux périodes se chevauchent`);
  }
  return punches;
}

const describePunches = (punches: DayPunch[]) =>
  punches.length
    ? punches.map((p) => `${p.start ?? '?'}-${p.end ?? '?'}${p.nextDay ? ' (lendemain)' : ''}`).join(', ')
    : 'aucun pointage';

// Validation hebdomadaire des temps : vue d'une semaine par employe, corrections
// (les donnees d'origine sont conservees), controle par le manager, validation
// par le RH qui fige et verrouille la semaine.
@Injectable()
export class TimeWeekService {
  private readonly logger = new Logger(TimeWeekService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly calculation: TimeCalculationService,
  ) {}

  // ── Calcul des semaines ──────────────────────────────────────────────────

  async computeWeeks(employeeIds: string[], monday: string): Promise<Map<string, ComputedWeek>> {
    const sunday = addDays(monday, 6);
    const dates = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
    const result = new Map<string, ComputedWeek>();
    if (employeeIds.length === 0) return result;
    const range = { gte: toDate(monday), lte: toDate(sunday) };
    const ids = { in: employeeIds };

    const [settings, options, rates, employees, holidayRows, ancestors, records, punches, entries, corrections, validations, leaves] =
      await Promise.all([
        this.calculation.loadSettings(),
        this.calculation.loadCorrections({}),
        this.calculation.loadPermanenceRates(),
        this.calculation.loadEmployees(employeeIds),
        this.calculation.loadHolidayRows(monday, sunday),
        this.calculation.loadOrganizationAncestors(),
        this.calculation.loadWorkRecords(monday, sunday, employeeIds),
        this.prisma.timeMorphoRecord.findMany({
          where: { EmployeeId: ids, DateJour: range },
          select: { EmployeeId: true, DateJour: true, PremierPointage: true, DernierPointage: true },
        }),
        this.prisma.timeManualEntry.findMany({
          where: { EmployeeId: ids, Date: range, Status: { in: ['Pending', 'Approved'] } },
          select: {
            Id: true, EmployeeId: true, Date: true, EntryType: true, Status: true, Source: true, Hours: true,
            FirstClockIn: true, LastClockOut: true,
          },
        }),
        this.prisma.timeDayCorrection.findMany({ where: { EmployeeId: ids, Date: range } }),
        this.prisma.timeWeekValidation.findMany({ where: { EmployeeId: ids, WeekStart: toDate(monday) } }),
        this.prisma.leaveRequest.findMany({
          where: {
            EmployeeId: ids, Status: { in: TAKEN_LEAVE_STATUSES }, IsDeleted: false,
            StartDate: { lte: toDate(sunday) }, EndDate: { gte: toDate(monday) },
          },
          select: { EmployeeId: true, StartDate: true, EndDate: true, leaveType: { select: { Name: true } } },
        }),
      ]);

    const scheduleCache = new Map<string, Schedule>();
    for (const id of employeeIds) {
      const employee = employees.get(id);
      if (!employee) continue;
      const validation = validations.find((v) => v.EmployeeId === id);
      const status = (validation?.Status ?? 'Open') as WeekStatus;
      const frozen = new Map(
        (status === 'Validated' ? parseJson<FrozenDay[]>(validation?.Snapshot, []) : []).map((d) => [d.date, d]),
      );
      const holidays = this.calculation.holidaysFor(employee, holidayRows, ancestors);
      const schedule = await this.calculation.scheduleOf(id, scheduleCache);
      const weekday = (key: string) => toDate(key).getUTCDay();

      const own = dates.map((d) => records.get(`${id}|${d}`)).filter((r) => r !== undefined);
      const { days } = computeDailyHours(
        own,
        holidays,
        (_e, key) => schedule?.required[weekday(key)] ?? null,
        (_e, key) => schedule?.breakHours[weekday(key)] ?? 0,
        options,
      );
      const byDate = new Map<string, DayHours>(days.map((d) => [d.dateKey, d]));
      const approved = entries.filter((e) => e.EmployeeId === id && e.Status === 'Approved');
      const continuous = settings.panierRequiresContinuous
        ? (day: DayHours) => {
            const record = records.get(`${id}|${day.dateKey}`);
            if (!record) return 0;
            const breakWindow = holidays.has(day.dateKey) ? null : schedule?.breaks[weekday(day.dateKey)];
            return longestContinuousHours(record, breakWindow);
          }
        : undefined;
      const autoPanier = new Set(
        computePanierDays(
          days,
          approved.filter((e) => e.EntryType === 'panier').map((e) => ({ employeeId: id, dateKey: keyOf(e.Date) })),
          settings.panierMinHours,
          monday,
          sunday,
          continuous,
        ).map((p) => p.dateKey),
      );
      const clocks = own;
      const overtimeByDay = employee.isCadre ? new Map<string, number>() : weeklyOvertimeByDay(days, clocks, holidays, settings);

      const weekDays: WeekDay[] = dates.map((date) => {
        const dayEntries = entries.filter((e) => e.EmployeeId === id && keyOf(e.Date) === date);
        const correction = corrections.find((c) => c.EmployeeId === id && keyOf(c.Date) === date);
        const fixed = frozen.get(date);
        const record = records.get(`${id}|${date}`);

        let list: DayPunch[];
        if (fixed) list = fixed.punches;
        else if (correction?.Punches != null) list = parseJson<DayPunch[]>(correction.Punches, []);
        else {
          list = [];
          const clockRows = punches.filter((p) => p.EmployeeId === id && keyOf(p.DateJour) === date);
          if (clockRows.length) {
            const first = clockRows.map((p) => p.PremierPointage).reduce((a, b) => (b < a ? b : a));
            const last = clockRows.map((p) => p.DernierPointage).reduce((a, b) => (b > a ? b : a));
            // Un seul passage a la pointeuse : la sortie manque.
            list.push(punchFromDates(first, last.getTime() === first.getTime() ? null : last, date, 'Morpho'));
          }
          for (const e of dayEntries) {
            if (e.Status === 'Approved' && WORK_ENTRY_TYPES.includes(e.EntryType ?? '') && (e.FirstClockIn || e.LastClockOut)) {
              list.push(punchFromDates(e.FirstClockIn, e.LastClockOut, date, e.Source === 'Import' ? 'Import' : 'Manual'));
            }
          }
        }
        const waiting = dayEntries.filter((e) => e.Status === 'Pending');
        const waitingPunches = waiting
          .filter((e) => WORK_ENTRY_TYPES.includes(e.EntryType ?? '') && (e.FirstClockIn || e.LastClockOut))
          .map((e) => ({ ...punchFromDates(e.FirstClockIn, e.LastClockOut, date, e.Source === 'Import' ? 'Import' : 'Manual'), pending: true }));

        const panier = fixed ? fixed.panier : (correction?.Panier ?? autoPanier.has(date));
        const permanence = fixed
          ? fixed.permanence
          : (correction?.Permanence ?? approved.some((e) => e.EntryType === 'permanence' && keyOf(e.Date) === date));
        const week = schedule?.required[weekday(date)];
        const leave = leaves.find((l) => l.EmployeeId === id && keyOf(l.StartDate) <= date && keyOf(l.EndDate) >= date);

        return {
          date,
          schedule: holidays.has(date) || week == null ? null : `${round2(week)} h`,
          holiday: holidays.has(date),
          leave: leave?.leaveType?.Name ?? null,
          punches: [...sortPunches(list).map((p) => ({ ...p, pending: false })), ...waitingPunches],
          extraHours: fixed ? fixed.extraHours : (record?.extraHours ?? 0),
          worked: byDate.has(date) ? round2(byDate.get(date)!.workedHours) : null,
          overtime: round2(overtimeByDay.get(`${id}|${date}`) ?? 0),
          panier,
          permanence,
          corrected: !!correction && (correction.Punches != null || correction.Panier != null || correction.Permanence != null),
          incomplete: list.some(isIncompletePunch),
          pendingEntryIds: waiting.map((e) => e.Id),
        };
      });

      // Repartition de la semaine par taux, avant le plafond non imposable (calcule en paie).
      const lines = employee.isCadre
        ? []
        : computeOvertimeLines({
            days,
            clocks,
            holidays,
            settings: { ...settings, monthlyNiCapHours: 0, monthlyNiCapCompanyWide: false },
            method: 'weekly',
            from: monday,
            to: sunday,
          });
      const sum = (category: string) => round2(lines.filter((l) => l.category === category).reduce((s, l) => s + l.hours, 0));
      const holidaySet = holidays;
      result.set(id, {
        employeeId: id,
        status,
        isCadre: employee.isCadre,
        controlledById: validation?.ControlledById ?? null,
        controlledAt: validation?.ControlledAt ?? null,
        validatedById: validation?.ValidatedById ?? null,
        validatedAt: validation?.ValidatedAt ?? null,
        days: weekDays,
        totals: {
          worked: round2(days.reduce((s, d) => s + d.workedHours, 0)),
          overtime: round2(weekDays.reduce((s, d) => s + d.overtime, 0)),
          hs130: sum('HS01'),
          hs150: sum('HS02'),
          night: sum('HS09'),
          holiday: sum('HS10'),
          // Les cadres n'ont ni panier ni permanence en paie.
          panier: employee.isCadre ? 0 : weekDays.filter((d) => d.panier).length,
          permanenceAmount: employee.isCadre
            ? 0
            : weekDays.filter((d) => d.permanence).reduce((s, d) => s + permanenceAmount(d.date, holidaySet, rates), 0),
        },
      });
    }
    return result;
  }

  // ── Perimetre ────────────────────────────────────────────────────────────

  private async assertAccess(employeeId: string, me: string, permissions: Set<string>) {
    if (permissions.has('TEMPS_ACCES')) return;
    const team = await this.calculation.teamEmployeeIds(me);
    if (!team.includes(employeeId.toLowerCase()) && !team.includes(employeeId)) {
      throw new ForbiddenException("Cet employé n'est pas dans votre équipe");
    }
  }

  // ── Lecture ──────────────────────────────────────────────────────────────

  async list(q: WeekListQueryDto, me: string, permissions: Set<string>) {
    const monday = mondayOf(q.WeekStart.slice(0, 10));
    const admin = permissions.has('TEMPS_ACCES');
    const team = admin ? null : await this.calculation.teamEmployeeIds(me);
    const search = q.Search?.trim();
    const where = {
      IsDeleted: false,
      IsSystem: false,
      Status: { in: ['Active', 'OnTrial'] },
      ...(team ? { Id: { in: team } } : {}),
      ...(search ? { OR: [{ FullName: { contains: search } }, { EmployeeNumber: { contains: search } }] } : {}),
    };
    const page = q.Page ?? 1;
    const pageSize = q.PageSize ?? 20;
    const [total, employees] = await Promise.all([
      this.prisma.employee.count({ where }),
      this.prisma.employee.findMany({
        where,
        select: { Id: true, FullName: true, EmployeeNumber: true },
        orderBy: [{ FullName: 'asc' }, { Id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    const weeks = await this.computeWeeks(employees.map((e) => e.Id), monday);
    return {
      WeekStart: monday,
      WeekEnd: addDays(monday, 6),
      WeekNumber: isoWeekNumber(monday),
      Total: total,
      Items: employees.map((e) => {
        const week = weeks.get(e.Id)!;
        return {
          EmployeeId: e.Id,
          FullName: e.FullName,
          EmployeeNumber: e.EmployeeNumber,
          Status: week.status,
          IsCadre: week.isCadre,
          Worked: week.totals.worked,
          Overtime: week.totals.overtime,
          IncompleteDays: week.days.filter((d) => d.incomplete).length,
          PendingEntries: week.days.reduce((s, d) => s + d.pendingEntryIds.length, 0),
          Corrected: week.days.some((d) => d.corrected),
        };
      }),
    };
  }

  async week(employeeId: string, weekStart: string, me: string, permissions: Set<string>) {
    await this.assertAccess(employeeId, me, permissions);
    const monday = mondayOf(weekStart.slice(0, 10));
    const employee = await this.prisma.employee.findFirst({
      where: { Id: employeeId, IsDeleted: false },
      select: { Id: true, FullName: true, EmployeeNumber: true, organizationUnit: { select: { Name: true } } },
    });
    if (!employee) throw new NotFoundException('Employé introuvable');
    const computed = (await this.computeWeeks([employee.Id], monday)).get(employee.Id)!;
    const history = await this.prisma.timeWeekHistory.findMany({
      where: { EmployeeId: employee.Id, WeekStart: toDate(monday) },
      orderBy: { CreatedAt: 'asc' },
    });
    const actorIds = [
      ...new Set([...history.map((h) => h.ActorId), computed.controlledById, computed.validatedById].filter((v): v is string => !!v)),
    ];
    const actors = actorIds.length
      ? await this.prisma.employee.findMany({ where: { Id: { in: actorIds } }, select: { Id: true, FullName: true } })
      : [];
    const nameOf = (id: string | null) => actors.find((a) => a.Id === id)?.FullName ?? null;

    const admin = permissions.has('TEMPS_ACCES');
    const blockers = this.blockers(computed, monday);
    return {
      Employee: { Id: employee.Id, FullName: employee.FullName, EmployeeNumber: employee.EmployeeNumber, Service: employee.organizationUnit?.Name ?? null },
      WeekStart: monday,
      WeekEnd: addDays(monday, 6),
      WeekNumber: isoWeekNumber(monday),
      Status: computed.status,
      IsCadre: computed.isCadre,
      ControlledBy: nameOf(computed.controlledById),
      ControlledAt: computed.controlledAt,
      ValidatedBy: nameOf(computed.validatedById),
      ValidatedAt: computed.validatedAt,
      Days: computed.days,
      Totals: computed.totals,
      // Ce qui empeche de controler ou valider.
      Blockers: blockers,
      CanEdit: computed.status !== 'Validated',
      CanControl: computed.status === 'Open' && blockers.length === 0,
      CanValidate: admin && computed.status !== 'Validated' && blockers.length === 0,
      CanReopen: admin && computed.status === 'Validated',
      History: history.map((h) => ({
        Action: h.Action,
        Actor: nameOf(h.ActorId),
        Comment: h.Comment,
        CreatedAt: h.CreatedAt,
      })),
    };
  }

  private blockers(week: ComputedWeek, monday: string): string[] {
    const out: string[] = [];
    if (addDays(monday, 6) >= todayKey()) out.push("La semaine n'est pas terminée");
    const incomplete = week.days.filter((d) => d.incomplete).map((d) => frShort(d.date));
    if (incomplete.length) out.push(`Pointage incomplet le ${incomplete.join(', ')}`);
    const pending = week.days.reduce((s, d) => s + d.pendingEntryIds.length, 0);
    if (pending) out.push(`${pending} saisie(s) en attente d'approbation`);
    return out;
  }

  // ── Corrections ──────────────────────────────────────────────────────────

  async saveDays(employeeId: string, dto: SaveWeekDto, me: string, permissions: Set<string>) {
    await this.assertAccess(employeeId, me, permissions);
    const monday = mondayOf(dto.WeekStart.slice(0, 10));
    const week = (await this.computeWeeks([employeeId], monday)).get(employeeId);
    if (!week) throw new NotFoundException('Employé introuvable');
    if (week.status === 'Validated') throw new BadRequestException('Cette semaine est validée : elle ne se modifie plus');

    // Tout est controle avant la premiere ecriture.
    const changes = dto.Days.map((sent) => {
      const date = sent.Date.slice(0, 10);
      const day = week.days.find((d) => d.date === date);
      if (!day) throw new BadRequestException(`${frShort(date)} n'appartient pas à la semaine`);
      if (day.pendingEntryIds.length && sent.Punches) {
        throw new BadRequestException(`${frShort(date)} : approuvez ou refusez d'abord les saisies en attente`);
      }
      const current = day.punches.filter((p) => !p.pending).map(({ pending: _pending, ...p }) => p);
      const punches = sent.Punches ? correctedPunches(date, sent.Punches, current) : null;
      const notes: string[] = [];
      if (punches) notes.push(`${describePunches(punches)} (avant : ${describePunches(current)})`);
      if (sent.Panier !== undefined) notes.push(`panier ${sent.Panier ? 'ajouté' : 'retiré'}`);
      if (sent.Permanence !== undefined) notes.push(`permanence ${sent.Permanence ? 'ajoutée' : 'retirée'}`);
      if (!notes.length) throw new BadRequestException(`${frShort(date)} : aucune modification`);
      return { date, day, punches, sent, note: `${frShort(date)} : ${notes.join(' ; ')}` };
    });

    await this.prisma.$transaction(async (tx) => {
      for (const change of changes) {
        const data = {
          ...(change.punches ? { Punches: JSON.stringify(change.punches), ExtraHours: change.day.extraHours } : {}),
          ...(change.sent.Panier !== undefined ? { Panier: change.sent.Panier } : {}),
          ...(change.sent.Permanence !== undefined ? { Permanence: change.sent.Permanence } : {}),
          ModifiedById: me,
          ModifiedAt: new Date(),
        };
        const where = { EmployeeId_Date: { EmployeeId: employeeId, Date: toDate(change.date) } };
        await tx.timeDayCorrection.upsert({ where, create: { EmployeeId: employeeId, Date: toDate(change.date), ...data }, update: data });
        const comment = dto.Comment?.trim() ? `${change.note}. Motif : ${dto.Comment.trim()}` : change.note;
        await tx.timeWeekHistory.create({
          data: { EmployeeId: employeeId, WeekStart: toDate(monday), Action: 'CORRECT', ActorId: me, Comment: comment.slice(0, 500) },
        });
      }
    });
    await removeControl(this.prisma, employeeId, monday, me, 'Semaine modifiée après le contrôle');
    await this.refreshDailyHours(employeeId, monday);
    return this.week(employeeId, monday, me, permissions);
  }

  // ── Controle, validation, reouverture ────────────────────────────────────

  private async checkedWeek(employeeId: string, weekStart: string, me: string, permissions: Set<string>) {
    await this.assertAccess(employeeId, me, permissions);
    const monday = mondayOf(weekStart.slice(0, 10));
    const week = (await this.computeWeeks([employeeId], monday)).get(employeeId);
    if (!week) throw new NotFoundException('Employé introuvable');
    return { monday, week };
  }

  async control(employeeId: string, weekStart: string, me: string, permissions: Set<string>) {
    const { monday, week } = await this.checkedWeek(employeeId, weekStart, me, permissions);
    if (week.status !== 'Open') throw new BadRequestException('Cette semaine est déjà contrôlée ou validée');
    const blockers = this.blockers(week, monday);
    if (blockers.length) throw new BadRequestException(blockers.join(' ; '));
    const data = { Status: 'Controlled', ControlledById: me, ControlledAt: new Date() };
    await this.setStatus(employeeId, monday, data, 'CONTROL', me);
    return this.week(employeeId, monday, me, permissions);
  }

  // La validation fige les pointages, paniers et permanences affiches : un import
  // ou une saisie posterieure ne change plus la semaine.
  async validate(employeeId: string, weekStart: string, me: string, permissions: Set<string>) {
    const { monday, week } = await this.checkedWeek(employeeId, weekStart, me, permissions);
    if (week.status === 'Validated') throw new BadRequestException('Cette semaine est déjà validée');
    const blockers = this.blockers(week, monday);
    if (blockers.length) throw new BadRequestException(blockers.join(' ; '));
    const snapshot: FrozenDay[] = week.days.map((d) => ({
      date: d.date,
      punches: d.punches.map(({ pending: _pending, ...p }) => p),
      extraHours: d.extraHours,
      panier: d.panier,
      permanence: d.permanence,
    }));
    const data = { Status: 'Validated', ValidatedById: me, ValidatedAt: new Date(), Snapshot: JSON.stringify(snapshot) };
    await this.setStatus(employeeId, monday, data, 'VALIDATE', me, week.status === 'Open' ? 'Validée sans contrôle préalable' : undefined);
    await this.refreshDailyHours(employeeId, monday);
    return this.week(employeeId, monday, me, permissions);
  }

  async reopen(employeeId: string, weekStart: string, comment: string, me: string, permissions: Set<string>) {
    if (!comment?.trim()) throw new BadRequestException('Le motif de la réouverture est requis');
    const { monday, week } = await this.checkedWeek(employeeId, weekStart, me, permissions);
    if (week.status !== 'Validated') throw new BadRequestException("Cette semaine n'est pas validée");
    await this.prisma.$transaction(async (tx) => {
      await tx.timeWeekValidation.deleteMany({ where: { EmployeeId: employeeId, WeekStart: toDate(monday) } });
      await tx.timeWeekHistory.create({
        data: { EmployeeId: employeeId, WeekStart: toDate(monday), Action: 'REOPEN', ActorId: me, Comment: comment.trim() },
      });
      // Quand seules les semaines validees partent en paie, ses lignes en sortent.
      const required = await tx.timeSetting.findUnique({ where: { Key: 'require_week_validation' } });
      if (Number(required?.Value ?? 0) === 1) {
        await tx.timeOvertime.deleteMany({
          where: { EmployeeId: employeeId, Date: { gte: toDate(monday), lte: toDate(addDays(monday, 6)) } },
        });
      }
    });
    await this.refreshDailyHours(employeeId, monday);
    return this.week(employeeId, monday, me, permissions);
  }

  private async setStatus(
    employeeId: string,
    monday: string,
    data: { Status: string } & Record<string, unknown>,
    action: string,
    me: string,
    comment?: string,
  ) {
    const where = { EmployeeId_WeekStart: { EmployeeId: employeeId, WeekStart: toDate(monday) } };
    await this.prisma.$transaction(async (tx) => {
      await tx.timeWeekValidation.upsert({ where, create: { EmployeeId: employeeId, WeekStart: toDate(monday), ...data }, update: data });
      await tx.timeWeekHistory.create({
        data: { EmployeeId: employeeId, WeekStart: toDate(monday), Action: action, ActorId: me, Comment: comment },
      });
    });
  }

  private async refreshDailyHours(employeeId: string, monday: string) {
    try {
      await this.calculation.calculateDailyHours(monday, addDays(monday, 6), {}, [employeeId]);
    } catch (err) {
      this.logger.warn(`Heures du jour non recalculées : ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

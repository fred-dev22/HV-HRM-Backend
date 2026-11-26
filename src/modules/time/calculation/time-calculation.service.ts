import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { CalendarService } from '../../calendar/calendar.service';
import { TIME_SETTINGS } from '../settings/time-setting-defaults';
import { OVERTIME_ONLY, PANIER_CODE, PERMANENCE_CODE } from './pay-codes';
import { WORK_ENTRY_TYPES, buildWorkRecords } from './work-records';
import { DayPunch, FrozenDay, parseJson, recordFromPunches } from './day-punches';
import { weekKey } from '../weeks/week-lock';
import {
  DEFAULT_TIME_SETTINGS,
  OvertimeMethod,
  PermanenceRates,
  SageSourceLine,
  TimeCalcSettings,
  buildSageRows,
  computeDailyHours,
  computeOvertimeLines,
  computePanierDays,
  computePermanenceLines,
  deductTravel,
  longestContinuousHours,
  addDays,
  mondayOf,
  weeklyOvertimeByDay,
  requiredHoursOfSchedule,
  round2,
  applyMonthlyNiCap,
  type OvertimeCategory,
  type ClockRecord,
  type DayHours,
  type BreakWindow,
} from './overtime-engine';
import { pairNightShifts, type DaySpan, type NightScheduleOf } from './night-shifts';

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;

// Horaire d'un calendrier, par jour de semaine (0 = dimanche).
export interface Schedule {
  required: (number | null)[];
  breaks: (BreakWindow | null)[];
  // Horaire du jour en clair (null : jour non travaille).
  hours: ({ start: string; end: string } | null)[];
  // D'ou vient le calendrier applique a l'employe.
  source: 'employee' | 'category' | 'global';
  name: string;
}

export interface DailyHoursResult {
  calculated: number;
  skipped: number;
  employeesWithoutCalendar: number;
  period: { from: string; to: string };
}

export interface OvertimeResult {
  calculated: number;
  excludedCadres: number;
  breakdown: Record<string, number>;
  // Methode effectivement utilisee (journaliere ou hebdomadaire).
  method: OvertimeMethod;
  period: { from: string; to: string };
  // Semaines ecartees faute de validation (reglage "payer les semaines validees").
  unvalidatedWeeks: number;
  // Present quand le calcul ne porte que sur un code (mode par code).
  code?: string;
}

interface EmployeeContext {
  id: string;
  employeeNumber: string;
  gender: string;
  isExpatriate: boolean;
  isCadre: boolean;
  organizationUnitId: string;
  createdAt: number;
}

const dateKey = (d: Date): string => d.toISOString().slice(0, 10);
const toDate = (key: string): Date => new Date(`${key}T00:00:00Z`);
const hhmm = (d: Date | null): string | null =>
  d ? `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}` : null;

function assertRange(from: string, to: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    throw new BadRequestException('Période invalide (format AAAA-MM-JJ attendu)');
  }
  if (from > to) throw new BadRequestException('La date de début doit précéder la date de fin');
}

// Branche le moteur de calcul (fonctions pures) sur les donnees du HRM :
// pointages Morpho, Calendrier (employe > categorie > global), jours feries,
// saisies validees. Ecrit TimeDailyHours et TimeOvertime.
// Ecriture d'une periode (suppression puis insertion par paquets) : des milliers de lignes depassent
// facilement le delai de 5 s par defaut d'une transaction Prisma (erreur P2028 "transaction expiree"
// vue sur un mois de pointage). Le calcul est fait avant la transaction ; elle ne fait qu'ecrire.
const WRITE_TX_OPTIONS = { timeout: 300_000, maxWait: 30_000 };

const DEFAULT_THRESHOLDS: Record<string, number> = Object.fromEntries(TIME_SETTINGS.map((s) => [s.Key, s.Value]));

@Injectable()
export class TimeCalculationService {
  private readonly logger = new Logger(TimeCalculationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly calendars: CalendarService,
  ) {}

  // ── Donnees de reference ──────────────────────────────────────────────────

  async loadSettings(): Promise<TimeCalcSettings> {
    const rows = await this.prisma.timeSetting.findMany();
    const byKey = new Map(rows.map((r) => [r.Key, Number(r.Value)]));
    const d = DEFAULT_TIME_SETTINGS;
    return {
      panierMinHours: byKey.get('panier_min_hours') ?? d.panierMinHours,
      nightStartHour: byKey.get('night_window_start_hour') ?? d.nightStartHour,
      nightEndHour: byKey.get('night_window_end_hour') ?? d.nightEndHour,
      weeklyHs01ThresholdHours: byKey.get('weekly_hs01_threshold_hours') ?? d.weeklyHs01ThresholdHours,
      monthlyNiCapHours: byKey.get('monthly_ni_cap_hours') ?? d.monthlyNiCapHours,
      monthlyNiCapCompanyWide: (byKey.get('monthly_ni_cap_company_wide') ?? (d.monthlyNiCapCompanyWide ? 1 : 0)) === 1,
      panierRequiresContinuous: (byKey.get('panier_requires_continuous') ?? (d.panierRequiresContinuous ? 1 : 0)) === 1,
    };
  }

  async loadPermanenceRates(): Promise<PermanenceRates> {
    const rows = await this.prisma.timePermanenceRate.findMany();
    const rate = (type: string) => Number(rows.find((r) => r.DayType === type)?.Amount ?? 0);
    return { OUVRABLE: rate('OUVRABLE'), SAMEDI: rate('SAMEDI'), DIMANCHE_FERIE: rate('DIMANCHE_FERIE') };
  }

  async loadEmployees(ids?: string[]): Promise<Map<string, EmployeeContext>> {
    const rows = await this.prisma.employee.findMany({
      where: { IsDeleted: false, ...(ids ? { Id: { in: ids } } : {}) },
      select: {
        Id: true,
        EmployeeNumber: true,
        Gender: true,
        IsExpatriate: true,
        IsCadre: true,
        OrganizationUnitId: true,
        CreatedAt: true,
      },
    });
    return new Map(
      rows.map((e) => [
        e.Id,
        {
          id: e.Id,
          employeeNumber: e.EmployeeNumber,
          gender: e.Gender,
          isExpatriate: e.IsExpatriate,
          isCadre: e.IsCadre,
          organizationUnitId: e.OrganizationUnitId,
          createdAt: e.CreatedAt.getTime(),
        },
      ]),
    );
  }

  // Ascendants de chaque entite (elle-meme incluse), pour les jours feries
  // cibles sur une entite.
  async loadOrganizationAncestors(): Promise<Map<string, Set<string>>> {
    const units = await this.prisma.organizationUnit.findMany({ select: { Id: true, ParentId: true } });
    const parent = new Map(units.map((u) => [u.Id, u.ParentId]));
    const result = new Map<string, Set<string>>();
    for (const u of units) {
      const chain = new Set<string>();
      let current: string | null = u.Id;
      while (current && !chain.has(current)) {
        chain.add(current);
        current = parent.get(current) ?? null;
      }
      result.set(u.Id, chain);
    }
    return result;
  }

  // Jours feries de la periode qui s'appliquent a UN employe (ciblage par
  // genre, expatrie et entite, comme pour les conges). Un ferie recurrent est
  // reporte sur chaque annee de la periode.
  async loadHolidayRows(from: string, to: string) {
    const all = await this.prisma.holiday.findMany();
    const fromYear = Number(from.slice(0, 4));
    const toYear = Number(to.slice(0, 4));
    const out: { dateKey: string; row: (typeof all)[number] }[] = [];
    for (const h of all) {
      const base = dateKey(h.Date);
      if (h.IsRecurring) {
        for (let y = fromYear; y <= toYear; y++) {
          const k = `${y}${base.slice(4)}`;
          if (k >= from && k <= to) out.push({ dateKey: k, row: h });
        }
      } else if (base >= from && base <= to) {
        out.push({ dateKey: base, row: h });
      }
    }
    return out;
  }

  holidaysFor(
    employee: EmployeeContext,
    rows: Awaited<ReturnType<TimeCalculationService['loadHolidayRows']>>,
    ancestors: Map<string, Set<string>>,
  ): Set<string> {
    const chain = ancestors.get(employee.organizationUnitId) ?? new Set([employee.organizationUnitId]);
    const set = new Set<string>();
    for (const { dateKey: k, row } of rows) {
      if (row.AppliesToGender && row.AppliesToGender !== employee.gender) continue;
      if (row.AppliesToExpatriate !== null && row.AppliesToExpatriate !== employee.isExpatriate) continue;
      if (row.OrganizationUnitId && !chain.has(row.OrganizationUnitId)) continue;
      set.add(k);
    }
    return set;
  }

  // Jours feries de la periode, employe par employe (utilise par la saisie en lot).
  async holidayKeysByEmployee(employeeIds: string[], from: string, to: string): Promise<Map<string, Set<string>>> {
    const employees = await this.loadEmployees(employeeIds);
    const rows = await this.loadHolidayRows(from, to);
    const ancestors = await this.loadOrganizationAncestors();
    return new Map(Array.from(employees.values()).map((e) => [e.id, this.holidaysFor(e, rows, ancestors)]));
  }

  // Heures prevues par jour de semaine (0 = dimanche) pour un employe, d'apres
  // son calendrier (employe > categorie > global). null = pas de calendrier.
  async scheduleOf(
    employeeId: string,
    cache: Map<string, Schedule>,
  ) {
    let calendar;
    try {
      calendar = await this.calendars.resolveForEmployee(employeeId);
    } catch {
      return null;
    }
    const cached = cache.get(calendar.Id);
    if (cached) return cached;
    const required: (number | null)[] = Array(7).fill(null);
    const breaks: Schedule['breaks'] = Array(7).fill(null);
    const hours: Schedule['hours'] = Array(7).fill(null);
    for (const wd of calendar.workDays) {
      const idx = DAY_NAMES.indexOf(wd.DayOfWeek as (typeof DAY_NAMES)[number]);
      if (idx < 0) continue;
      const day = {
        isWorkingDay: wd.IsEnabled,
        startTime: hhmm(wd.StartTime),
        endTime: hhmm(wd.EndTime),
        breakStart: wd.BreakEnabled ? hhmm(wd.BreakStartTime) : null,
        breakEnd: wd.BreakEnabled ? hhmm(wd.BreakEndTime) : null,
      };
      required[idx] = requiredHoursOfSchedule(day);
      if (!day.isWorkingDay) continue;
      if (day.startTime && day.endTime) hours[idx] = { start: day.startTime, end: day.endTime };
      if (day.breakStart && day.breakEnd) {
        const overnight = !!day.startTime && !!day.endTime && day.endTime < day.startTime;
        const nextDay = overnight && day.breakStart < day.startTime!;
        breaks[idx] = { start: day.breakStart, end: day.breakEnd, ...(nextDay ? { nextDay } : {}) };
      }
    }
    const source: Schedule['source'] = calendar.EmployeeId ? 'employee' : calendar.EmployeeCategoryId ? 'category' : 'global';
    const value = { required, breaks, hours, source, name: calendar.Name };
    cache.set(calendar.Id, value);
    return value;
  }

  // Passages de la pointeuse de la periode, une plage par employe et par jour. Les
  // postes de nuit (horaire finissant le lendemain) sont reconstitues : la veille
  // et le lendemain de la periode sont lus pour cela.
  async loadPunchSpans(from: string, to: string, employeeIds?: string[]): Promise<DaySpan[]> {
    const day = 86_400_000;
    const rows = await this.prisma.timeMorphoRecord.findMany({
      where: {
        EmployeeId: employeeIds ? { in: employeeIds } : { not: null },
        DateJour: { gte: new Date(toDate(from).getTime() - day), lte: new Date(toDate(to).getTime() + day) },
      },
      select: { EmployeeId: true, DateJour: true, PremierPointage: true, DernierPointage: true },
    });
    // Plusieurs lignes le meme jour (fichiers qui se recouvrent) : une seule plage.
    const merged = new Map<string, DaySpan>();
    for (const r of rows) {
      const key = `${r.EmployeeId}|${dateKey(r.DateJour)}`;
      const span = merged.get(key);
      if (!span) {
        merged.set(key, { employeeId: r.EmployeeId!, dateKey: dateKey(r.DateJour), first: r.PremierPointage, last: r.DernierPointage });
      } else {
        if (r.PremierPointage < span.first) span.first = r.PremierPointage;
        if (r.DernierPointage > span.last) span.last = r.DernierPointage;
      }
    }
    let spans = [...merged.values()];
    const nightFor = spans.length ? await this.nightSchedules([...new Set(spans.map((s) => s.employeeId))]) : null;
    if (nightFor) spans = pairNightShifts(spans, nightFor);
    return spans.filter((s) => s.dateKey >= from && s.dateKey <= to);
  }

  // Horaires de nuit des employes ; null quand aucun calendrier n'en contient.
  private async nightSchedules(employeeIds: string[]): Promise<NightScheduleOf | null> {
    const days = await this.prisma.calendarWorkDay.findMany({ where: { IsEnabled: true }, select: { StartTime: true, EndTime: true } });
    if (!days.some((d) => d.StartTime && d.EndTime && d.EndTime < d.StartTime)) return null;
    const cache = new Map<string, Schedule>();
    const schedules = new Map<string, Schedule | null>();
    for (const id of employeeIds) schedules.set(id, await this.scheduleOf(id, cache));
    return (employeeId, key) => {
      const hours = schedules.get(employeeId)?.hours[toDate(key).getUTCDay()];
      return hours && hours.end < hours.start ? hours : null;
    };
  }

  // Temps travaille de la periode, par `employe|jour` : pointeuse et saisies de
  // travail approuvees.
  async loadWorkRecords(from: string, to: string, employeeIds?: string[]): Promise<Map<string, ClockRecord>> {
    const range = { gte: toDate(from), lte: toDate(to) };
    const [punches, declared] = await Promise.all([
      this.loadPunchSpans(from, to, employeeIds),
      this.prisma.timeManualEntry.findMany({
        where: {
          Status: 'Approved',
          EntryType: { in: WORK_ENTRY_TYPES },
          Date: range,
          ...(employeeIds ? { EmployeeId: { in: employeeIds } } : {}),
        },
        select: { EmployeeId: true, Date: true, EntryType: true, Hours: true, FirstClockIn: true, LastClockOut: true },
      }),
    ]);
    const records = buildWorkRecords(
      punches.map((p) => ({ employeeId: p.employeeId, dateKey: p.dateKey, firstClock: p.first, lastClock: p.last })),
      declared.map((d) => ({
        employeeId: d.EmployeeId,
        dateKey: dateKey(d.Date),
        start: d.FirstClockIn,
        end: d.LastClockOut,
        hours: Number(d.Hours),
        remote: d.EntryType !== 'travail_sur_site',
      })),
    );
    const who = employeeIds ? { EmployeeId: { in: employeeIds } } : {};
    const [corrected, validated] = await Promise.all([
      this.prisma.timeDayCorrection.findMany({
        where: { ...who, Date: range, Punches: { not: null } },
        select: { EmployeeId: true, Date: true, Punches: true, ExtraHours: true },
      }),
      this.prisma.timeWeekValidation.findMany({
        where: { ...who, Status: 'Validated', WeekStart: { gte: toDate(mondayOf(from)), lte: toDate(to) } },
        select: { EmployeeId: true, Snapshot: true },
      }),
    ]);
    for (const c of corrected) {
      const day = dateKey(c.Date);
      records.set(
        `${c.EmployeeId}|${day}`,
        recordFromPunches(c.EmployeeId, day, parseJson<DayPunch[]>(c.Punches, []), Number(c.ExtraHours)),
      );
    }
    // Minutes de trajet figees avec les semaines validees.
    const frozenMinutes = new Map<string, number>();
    // Une semaine validee est figee : ses jours passent avant tout le reste.
    for (const week of validated) {
      for (const d of parseJson<FrozenDay[]>(week.Snapshot, [])) {
        if (d.date < from || d.date > to) continue;
        const key = `${week.EmployeeId}|${d.date}`;
        frozenMinutes.set(key, d.travelMinutes ?? 0);
        if (d.punches.length || d.extraHours) {
          records.set(key, { ...recordFromPunches(week.EmployeeId, d.date, d.punches, d.extraHours), pause: d.pause ?? null });
        } else records.delete(key);
      }
    }
    if (records.size === 0) return records;
    const travel = await this.loadTravelMinutes([...new Set([...records.values()].map((r) => r.employeeId))]);
    for (const [key, record] of records) {
      records.set(key, deductTravel(record, frozenMinutes.get(key) ?? travel.get(record.employeeId) ?? 0));
    }
    return records;
  }

  // Minutes de trajet et de changement par employe : non-cadres rattaches a un site.
  async loadTravelMinutes(employeeIds: string[]): Promise<Map<string, number>> {
    const rows = await this.prisma.employee.findMany({
      where: { Id: { in: employeeIds }, IsCadre: false, TimeSiteId: { not: null } },
      select: { Id: true, timeSite: { select: { DeductionMinutes: true } } },
    });
    return new Map(rows.map((e) => [e.Id, e.timeSite?.DeductionMinutes ?? 0]));
  }

  // Paniers et permanences decides a la validation hebdomadaire, par `employe|jour`
  // (null : calcul automatique). Une semaine validee les fixe pour ses 7 jours.
  private async loadAllowanceOverrides(from: string, to: string) {
    const [corrected, validated] = await Promise.all([
      this.prisma.timeDayCorrection.findMany({
        where: { Date: { gte: toDate(from), lte: toDate(to) } },
        select: { EmployeeId: true, Date: true, Panier: true, Permanence: true },
      }),
      this.prisma.timeWeekValidation.findMany({
        where: { Status: 'Validated', WeekStart: { gte: toDate(mondayOf(from)), lte: toDate(to) } },
        select: { EmployeeId: true, Snapshot: true },
      }),
    ]);
    const result = new Map<string, { employeeId: string; dateKey: string; panier: boolean | null; permanence: boolean | null }>();
    for (const c of corrected) {
      const day = dateKey(c.Date);
      result.set(`${c.EmployeeId}|${day}`, { employeeId: c.EmployeeId, dateKey: day, panier: c.Panier, permanence: c.Permanence });
    }
    for (const week of validated) {
      for (const d of parseJson<FrozenDay[]>(week.Snapshot, [])) {
        if (d.date < from || d.date > to) continue;
        result.set(`${week.EmployeeId}|${d.date}`, { employeeId: week.EmployeeId, dateKey: d.date, panier: d.panier, permanence: d.permanence });
      }
    }
    return result;
  }

  // ── T4 : heures du jour ───────────────────────────────────────────────────

  // Corrections optionnelles, reglees dans TimeSetting (0/1) ; un parametre
  // explicite de l'appel les remplace.
  async loadCorrections(override: { deductBreak?: boolean; includeNonWorkingDays?: boolean }) {
    const rows = await this.prisma.timeSetting.findMany({ where: { Key: { in: ['deduct_break', 'include_non_working_days'] } } });
    const flag = (key: string) =>
      Number(rows.find((r) => r.Key === key)?.Value ?? TIME_SETTINGS.find((d) => d.Key === key)?.Value ?? 0) === 1;
    return {
      deductBreak: override.deductBreak ?? flag('deduct_break'),
      includeNonWorkingDays: override.includeNonWorkingDays ?? flag('include_non_working_days'),
    };
  }

  async calculateDailyHours(
    from: string,
    to: string,
    override: { deductBreak?: boolean; includeNonWorkingDays?: boolean } = {},
    // Limite le recalcul a ces employes (saisie approuvee) ; absent : tout le monde.
    employeeIds?: string[],
  ): Promise<DailyHoursResult> {
    assertRange(from, to);
    const { deductBreak, includeNonWorkingDays } = await this.loadCorrections(override);
    const merged = await this.loadWorkRecords(from, to, employeeIds);

    const employees = await this.loadEmployees(Array.from(new Set(Array.from(merged.values()).map((m) => m.employeeId))));
    const holidayRows = await this.loadHolidayRows(from, to);
    const ancestors = await this.loadOrganizationAncestors();
    const scheduleCache = new Map<string, Schedule>();

    const days: DayHours[] = [];
    let skipped = 0;
    let employeesWithoutCalendar = 0;

    const byEmployee = new Map<string, ClockRecord[]>();
    for (const m of merged.values()) {
      if (!byEmployee.has(m.employeeId)) byEmployee.set(m.employeeId, []);
      byEmployee.get(m.employeeId)!.push(m);
    }

    for (const [employeeId, clocks] of byEmployee) {
      const employee = employees.get(employeeId);
      if (!employee) {
        skipped += clocks.length;
        continue;
      }
      const schedule = await this.scheduleOf(employeeId, scheduleCache);
      if (!schedule) {
        employeesWithoutCalendar++;
        skipped += clocks.length;
        continue;
      }
      const dow = (key: string) => toDate(key).getUTCDay();
      const result = computeDailyHours(
        clocks,
        this.holidaysFor(employee, holidayRows, ancestors),
        (_e, key) => schedule.required[dow(key)] ?? null,
        (_e, key) => schedule.breaks[dow(key)] ?? null,
        { deductBreak, includeNonWorkingDays },
      );
      days.push(...result.days);
      skipped += result.skipped;
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.timeDailyHours.deleteMany({
        where: { Date: { gte: toDate(from), lte: toDate(to) }, ...(employeeIds ? { EmployeeId: { in: employeeIds } } : {}) },
      });
      for (let i = 0; i < days.length; i += 500) {
        await tx.timeDailyHours.createMany({
          data: days.slice(i, i + 500).map((d) => ({
            EmployeeId: d.employeeId,
            Date: toDate(d.dateKey),
            WorkedHours: d.workedHours,
            RequiredHours: d.requiredHours,
          })),
        });
      }
    }, WRITE_TX_OPTIONS);

    return { calculated: days.length, skipped, employeesWithoutCalendar, period: { from, to } };
  }

  // ── T5 : heures supplementaires, panier, permanence ───────────────────────

  // Methode unique : le calcul se fait toujours a la semaine (au-dela de 40 h). Le
  // reglage 'overtime_method' n'est plus lu, quelle que soit sa valeur en base : le
  // meme resultat chez tous les clients. Une demande explicite du mode journalier
  // est refusee plutot qu'ignoree en silence, car elle changerait la paie.
  private async resolveMethod(requested?: OvertimeMethod): Promise<OvertimeMethod> {
    if (requested && requested !== 'weekly') {
      throw new BadRequestException('Le calcul des heures supplémentaires se fait uniquement à la semaine (au-delà de 40 h).');
    }
    return 'weekly';
  }

  // Etat des calculs d'une periode : T5 part des heures journalieres de T4.
  async calculationStatus(from: string, to: string): Promise<{ dailyRows: number; overtimeRows: number }> {
    assertRange(from, to);
    const range = { gte: toDate(from), lte: toDate(to) };
    const [dailyRows, overtimeRows] = await Promise.all([
      this.prisma.timeDailyHours.count({ where: { Date: range } }),
      this.prisma.timeOvertime.count({ where: { Date: range } }),
    ]);
    return { dailyRows, overtimeRows };
  }

  async calculateOvertime(from: string, to: string, requestedMethod?: OvertimeMethod, onlyCode?: string): Promise<OvertimeResult> {
    assertRange(from, to);
    if ((await this.calculationStatus(from, to)).dailyRows === 0) {
      throw new BadRequestException("Aucune heure journalière calculée sur cette période. Lancez d'abord le calcul T4.");
    }
    const method = await this.resolveMethod(requestedMethod);
    const settings = await this.loadSettings();
    // La methode hebdomadaire demande la semaine entiere : on remonte au lundi.
    const widenedFrom = method === 'weekly' ? mondayOf(from) : from;

    const codes = await this.prisma.timeAttendanceCode.findMany();
    const codeId = new Map(codes.map((c) => [c.Code, c.Id]));
    const needed = ['HS01', 'HS02', 'HS03', 'HS04', 'HS09', 'HS10', PANIER_CODE, PERMANENCE_CODE];
    const missing = needed.filter((c) => !codeId.has(c));
    if (missing.length > 0) {
      throw new BadRequestException(`Code(s) de paie introuvable(s) : ${missing.join(', ')}. Relancer le seed.`);
    }

    const dailyRows = await this.prisma.timeDailyHours.findMany({
      where: { Date: { gte: toDate(widenedFrom), lte: toDate(to) } },
    });
    const merged = await this.loadWorkRecords(widenedFrom, to);

    const employees = await this.loadEmployees(Array.from(new Set(dailyRows.map((d) => d.EmployeeId))));
    const holidayRows = await this.loadHolidayRows(widenedFrom, to);
    const ancestors = await this.loadOrganizationAncestors();

    const approved = await this.prisma.timeManualEntry.findMany({
      where: {
        Status: 'Approved',
        EntryType: { in: ['panier', 'permanence'] },
        Date: { gte: toDate(from), lte: toDate(to) },
      },
      select: { EmployeeId: true, Date: true, EntryType: true },
    });

    // Heures non imposables deja attribuees dans le mois avant la periode : un
    // calcul semaine par semaine ne doit pas redonner un plafond a chaque fois.
    const monthStart = `${from.slice(0, 7)}-01`;
    const priorNi =
      from > monthStart
        ? await this.prisma.timeOvertime.findMany({
            where: { Date: { gte: toDate(monthStart), lt: toDate(from) }, code: { Code: { in: ['HS03', 'HS04'] } } },
            select: { EmployeeId: true, Hours: true },
          })
        : [];
    const niAlreadyUsed = new Map<string, number>();
    for (const line of priorNi) {
      const key = settings.monthlyNiCapCompanyWide ? from.slice(0, 7) : `${line.EmployeeId}|${from.slice(0, 7)}`;
      niAlreadyUsed.set(key, (niAlreadyUsed.get(key) ?? 0) + Number(line.Hours));
    }

    const scheduleCache = new Map<string, Schedule>();
    const rates = await this.loadPermanenceRates();
    const overrides = await this.loadAllowanceOverrides(from, to);
    // Reglage : seules les semaines validees par le RH partent en paie.
    const onlyValidated =
      Number((await this.prisma.timeSetting.findUnique({ where: { Key: 'require_week_validation' } }))?.Value ?? 0) === 1;
    const validated = onlyValidated
      ? new Set(
          (
            await this.prisma.timeWeekValidation.findMany({
              where: { Status: 'Validated', WeekStart: { gte: toDate(widenedFrom), lte: toDate(to) } },
              select: { EmployeeId: true, WeekStart: true },
            })
          ).map((v) => weekKey(v.EmployeeId, dateKey(v.WeekStart))),
        )
      : null;
    const skippedWeeks = new Set<string>();
    const payable = (employeeId: string, day: string) => {
      if (!validated) return true;
      const key = weekKey(employeeId, day);
      if (validated.has(key)) return true;
      skippedWeeks.add(key);
      return false;
    };
    const out: { employeeId: string; dateKey: string; code: string; hours: number }[] = [];
    let excludedCadres = 0;

    const forced = [...overrides.values()].filter((o) => o.panier === true || o.permanence === true);
    const employeeIds = new Set([
      ...dailyRows.map((d) => d.EmployeeId),
      ...approved.map((a) => a.EmployeeId),
      ...forced.map((o) => o.employeeId),
    ]);
    const extraEmployees = await this.loadEmployees(Array.from(employeeIds).filter((id) => !employees.has(id)));
    for (const [id, e] of extraEmployees) employees.set(id, e);

    for (const employeeId of employeeIds) {
      const employee = employees.get(employeeId);
      if (!employee) continue;
      if (employee.isCadre) {
        excludedCadres++;
        continue;
      }
      const holidays = this.holidaysFor(employee, holidayRows, ancestors);
      const days: DayHours[] = dailyRows
        .filter((d) => d.EmployeeId === employeeId && payable(employeeId, dateKey(d.Date)))
        .map((d) => ({
          employeeId,
          dateKey: dateKey(d.Date),
          workedHours: Number(d.WorkedHours),
          requiredHours: Number(d.RequiredHours),
        }));
      const clocks = Array.from(merged.values()).filter((c) => c.employeeId === employeeId);

      for (const l of computeOvertimeLines({ days, clocks, holidays, settings, method, from, to, niAlreadyUsed })) {
        out.push({ employeeId, dateKey: l.dateKey, code: l.category, hours: l.hours });
      }

      const mine = approved.filter((a) => a.EmployeeId === employeeId && payable(employeeId, dateKey(a.Date)));
      const decided = forced.filter((o) => o.employeeId === employeeId && payable(employeeId, o.dateKey));
      const manualPanier = [
        ...mine.filter((a) => a.EntryType === 'panier').map((a) => ({ employeeId, dateKey: dateKey(a.Date) })),
        ...decided.filter((o) => o.panier === true).map((o) => ({ employeeId, dateKey: o.dateKey })),
      ];
      const schedule = settings.panierRequiresContinuous ? await this.scheduleOf(employeeId, scheduleCache) : null;
      const continuousHours = settings.panierRequiresContinuous
        ? (day: DayHours) => {
            const record = merged.get(`${employeeId}|${day.dateKey}`);
            if (!record) return 0;
            // Jour ferie : l'horaire ne s'applique pas, aucune pause n'est supposee.
            const breakWindow = holidays.has(day.dateKey) ? null : schedule?.breaks[toDate(day.dateKey).getUTCDay()];
            return longestContinuousHours(record, breakWindow);
          }
        : undefined;
      for (const p of computePanierDays(days, manualPanier, settings.panierMinHours, from, to, continuousHours)) {
        if (overrides.get(`${employeeId}|${p.dateKey}`)?.panier === false) continue;
        out.push({ employeeId, dateKey: p.dateKey, code: PANIER_CODE, hours: 1 });
      }
      // Une permanence par jour : saisie approuvee ou cochee a la validation, sauf retiree.
      const onCall = new Set([
        ...mine.filter((a) => a.EntryType === 'permanence').map((a) => dateKey(a.Date)),
        ...decided.filter((o) => o.permanence === true).map((o) => o.dateKey),
      ]);
      const permanence = [...onCall]
        .filter((day) => overrides.get(`${employeeId}|${day}`)?.permanence !== false)
        .map((day) => ({ employeeId, dateKey: day }));
      for (const p of computePermanenceLines(permanence, holidays, rates)) {
        out.push({ employeeId, dateKey: p.dateKey, code: PERMANENCE_CODE, hours: p.amount });
      }
    }

    if (settings.monthlyNiCapCompanyWide) {
      // Un seul plafond mensuel pour toute l'entreprise : consomme par date, puis par employe.
      const hs = out
        .filter((o) => o.code === 'HS01' || o.code === 'HS02')
        .map((o) => ({ employeeId: o.employeeId, dateKey: o.dateKey, hours: o.hours, category: o.code as OvertimeCategory }));
      // Meme jour : l'employe cree le premier est servi le premier (comme l'ordre d'id de Pointage).
      const rank = new Map(Array.from(employees.values()).map((e) => [e.id, e.createdAt]));
      applyMonthlyNiCap(hs, settings.monthlyNiCapHours, true, rank, niAlreadyUsed);
      const rest = out.filter((o) => o.code !== 'HS01' && o.code !== 'HS02');
      out.length = 0;
      out.push(...rest, ...hs.map((l) => ({ employeeId: l.employeeId, dateKey: l.dateKey, code: l.category as string, hours: l.hours })));
    }

    // Mode par code : memes regles que le calcul general (le plafond non imposable compte), mais on ne
    // remplace que les lignes du code demande, pour ne pas ecraser les autres codes deja calcules.
    if (onlyCode) {
      if (!codeId.has(onlyCode)) throw new BadRequestException(`Code de paie introuvable : ${onlyCode}`);
      const kept = out.filter((o) => o.code === onlyCode);
      out.length = 0;
      out.push(...kept);
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.timeOvertime.deleteMany({
        where: { Date: { gte: toDate(from), lte: toDate(to) }, ...(onlyCode ? { CodeId: codeId.get(onlyCode) } : {}) },
      });
      for (let i = 0; i < out.length; i += 500) {
        await tx.timeOvertime.createMany({
          data: out.slice(i, i + 500).map((l) => ({
            EmployeeId: l.employeeId,
            CodeId: codeId.get(l.code)!,
            Date: toDate(l.dateKey),
            // Chaque ligne est arrondie au centieme a l'enregistrement, comme Pointage : les totaux Sage s'additionnent sur ces lignes.
            Hours: round2(l.hours),
          })),
        });
      }
    }, WRITE_TX_OPTIONS);

    const breakdown: Record<string, number> = {};
    for (const l of out) breakdown[l.code] = round2((breakdown[l.code] ?? 0) + round2(l.hours));
    return {
      calculated: out.length,
      excludedCadres,
      breakdown,
      method,
      period: { from, to },
      unvalidatedWeeks: skippedWeeks.size,
      ...(onlyCode ? { code: onlyCode } : {}),
    };
  }

  // ── Lecture : rapport et export Sage ──────────────────────────────────────

  async overtimeReport(from: string, to: string, employeeIds?: string[]) {
    assertRange(from, to);
    const rows = await this.prisma.timeOvertime.findMany({
      where: {
        Date: { gte: toDate(from), lte: toDate(to) },
        ...(employeeIds ? { EmployeeId: { in: employeeIds } } : {}),
        // Les cadres n'apparaissent jamais dans la paie, meme si des lignes ont ete calculees avant qu'ils soient marques cadres.
        employee: { IsCadre: false },
      },
      include: { employee: { select: { FullName: true, EmployeeNumber: true } }, code: { include: { type: true } } },
      orderBy: [{ Date: 'asc' }],
    });
    const byEmployee = new Map<
      string,
      { employeeId: string; name: string; employeeNumber: string; lines: object[]; totalsByCode: Record<string, number> }
    >();
    for (const r of rows) {
      if (!byEmployee.has(r.EmployeeId)) {
        byEmployee.set(r.EmployeeId, {
          employeeId: r.EmployeeId,
          name: r.employee.FullName,
          employeeNumber: r.employee.EmployeeNumber,
          lines: [],
          totalsByCode: {},
        });
      }
      const e = byEmployee.get(r.EmployeeId)!;
      e.lines.push({ date: dateKey(r.Date), code: r.code.Code, type: r.code.type.Name, hours: Number(r.Hours) });
      e.totalsByCode[r.code.Code] = round2((e.totalsByCode[r.code.Code] ?? 0) + Number(r.Hours));
    }
    return { period: { from, to }, employees: Array.from(byEmployee.values()) };
  }

  async sageRows(from: string, to: string) {
    assertRange(from, to);
    const rows = await this.prisma.timeOvertime.findMany({
      where: { Date: { gte: toDate(from), lte: toDate(to) }, employee: { IsCadre: false } },
      include: { employee: { select: { EmployeeNumber: true } }, code: { include: { type: true } } },
    });
    const lines: SageSourceLine[] = rows.map((r) => ({
      employeeNumber: r.employee.EmployeeNumber,
      codeId: r.CodeId,
      code: r.code.Code,
      sageTypeCode: r.code.type.SageTypeCode,
      hours: Number(r.Hours),
    }));
    try {
      return buildSageRows(lines);
    } catch (err) {
      throw new BadRequestException(err instanceof Error ? err.message : String(err));
    }
  }

  // Seuils mensuels d'heures supplementaires ; reglage absent : valeur d'usine.
  async overtimeThresholds(): Promise<{ alertHours: number; legalHours: number }> {
    const keys = ['overtime_alert_hours', 'overtime_legal_cap_hours'];
    const rows = await this.prisma.timeSetting.findMany({ where: { Key: { in: keys } } });
    const [alertHours, legalHours] = keys.map((k) => Number(rows.find((r) => r.Key === k)?.Value ?? DEFAULT_THRESHOLDS[k]));
    return { alertHours: alertHours!, legalHours: legalHours! };
  }

  // Heures supplementaires du mois par employe, d'apres les heures du jour (a
  // jour des imports, saisies approuvees et corrections), sans attendre la paie.
  // Comme en paie, une semaine appartient au mois de son dimanche.
  async monthlyOvertime(employeeIds: string[], month: string): Promise<Map<string, number>> {
    const [year, number] = month.split('-').map(Number);
    const first = `${month}-01`;
    const last = dateKey(new Date(Date.UTC(year!, number!, 0)));
    const firstSunday = addDays(first, (7 - toDate(first).getUTCDay()) % 7);
    const lastSunday = addDays(last, -toDate(last).getUTCDay());
    const byDay = await this.weeklyOvertime(employeeIds, addDays(firstSunday, -6), lastSunday);
    const totals = new Map<string, number>();
    for (const [key, hours] of byDay) {
      const id = key.slice(0, key.indexOf('|'));
      totals.set(id, (totals.get(id) ?? 0) + hours);
    }
    return totals;
  }

  // Equipe suivie par les alertes : celle du manager, ceux dont il est
  // l'interimaire du validateur direct, et ceux que couvre un pool de validation
  // des temps dont il est membre ou interimaire.
  async alertTeamIds(me: string): Promise<string[]> {
    const ids = new Set(await this.teamEmployeeIds(me));
    const [interimOf, pools] = await Promise.all([
      this.prisma.employee.findMany({
        where: { IsDeleted: false, IsSystem: false, directValidator: { ValidatorInterimId: me } },
        select: { Id: true },
      }),
      this.prisma.approvalPool.findMany({
        where: { ObjectType: 'TimeEntry', IsActive: true },
        select: { OrganizationUnitId: true, members: { select: { EmployeeId: true, InterimEmployeeId: true } } },
      }),
    ]);
    interimOf.forEach((e) => ids.add(e.Id));
    const poolByUnit = new Map(pools.map((p) => [p.OrganizationUnitId, p]));
    if (pools.some((p) => p.members.some((m) => m.EmployeeId === me || m.InterimEmployeeId === me))) {
      const [others, ancestors] = await Promise.all([
        this.prisma.employee.findMany({
          where: { IsDeleted: false, IsSystem: false, DirectValidatorId: null },
          select: { Id: true, OrganizationUnitId: true },
        }),
        this.loadOrganizationAncestors(),
      ]);
      for (const e of others) {
        // La chaine part de l'entite de l'employe : le premier pool rencontre s'applique.
        const unit = [...(ancestors.get(e.OrganizationUnitId) ?? [])].find((u) => poolByUnit.has(u));
        const members = unit ? poolByUnit.get(unit)!.members : [];
        if (members.some((m) => m.EmployeeId === me || m.InterimEmployeeId === me)) ids.add(e.Id);
      }
    }
    ids.delete(me);
    return [...ids];
  }

  // Employes dont les heures supplementaires du mois atteignent le seuil
  // d'alerte. employeeIds : null = toute l'entreprise (RH).
  async overtimeAlerts(employeeIds: string[] | null, month?: string) {
    const now = new Date();
    const key = month ?? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const start = toDate(`${key}-01`);
    const range = { gte: start, lt: new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1)) };
    const { alertHours, legalHours } = await this.overtimeThresholds();

    const scope = (
      await this.prisma.employee.findMany({
        where: { IsCadre: false, IsDeleted: false, IsSystem: false, ...(employeeIds ? { Id: { in: employeeIds } } : {}) },
        select: { Id: true },
      })
    ).map((e) => e.Id);
    const [totals, latest] = await Promise.all([
      this.monthlyOvertime(scope, key),
      this.prisma.timeDailyHours.aggregate({ where: { Date: range }, _max: { Date: true } }),
    ]);
    const reached = [...totals]
      .map(([id, hours]) => ({ id, hours: round2(hours) }))
      .filter((t) => t.hours > 0 && t.hours >= alertHours);
    const employees = reached.length
      ? await this.prisma.employee.findMany({
          where: { Id: { in: reached.map((r) => r.id) } },
          select: { Id: true, FullName: true, EmployeeNumber: true },
        })
      : [];
    const byId = new Map(employees.map((e) => [e.Id, e]));
    return {
      Month: key,
      AlertHours: alertHours,
      LegalHours: legalHours,
      // Dernier jour du mois avec des heures, null s'il n'y en a aucun.
      LastCalculatedDate: latest._max.Date ? dateKey(latest._max.Date) : null,
      Employees: reached
        .sort((a, b) => b.hours - a.hours)
        .map((r) => ({
          EmployeeId: r.id,
          FullName: byId.get(r.id)?.FullName ?? '',
          EmployeeNumber: byId.get(r.id)?.EmployeeNumber ?? '',
          Hours: r.hours,
          LegalCapReached: r.hours >= legalHours,
        })),
    };
  }

  // Feuille de temps d'un employe : une ligne par jour de la periode.
  // Employes de l'equipe d'un validateur : ceux dont il est le validateur direct
  // et ceux des entites qu'il dirige.
  async teamEmployeeIds(managerId: string): Promise<string[]> {
    const rows = await this.prisma.employee.findMany({
      where: {
        IsDeleted: false,
        IsSystem: false,
        Id: { not: managerId },
        OR: [{ DirectValidatorId: managerId }, { organizationUnit: { ManagerId: managerId } }],
      },
      select: { Id: true },
    });
    return rows.map((r) => r.Id);
  }

  // Heures prevues de CHAQUE jour du calendrier (pas seulement des jours pointes), comme la
  // feuille de temps de Pointage : ferie = 0, sinon horaire de l'employe (employe > categorie >
  // global), 0 le jour non travaille ou sans horaire. Cle : `${employeId}|${AAAA-MM-JJ}`.
  private async requiredPerDay(employeeIds: string[], from: string, to: string): Promise<Map<string, number>> {
    const result = new Map<string, number>();
    if (employeeIds.length === 0) return result;
    const employees = await this.loadEmployees(employeeIds);
    const holidayRows = await this.loadHolidayRows(from, to);
    const ancestors = await this.loadOrganizationAncestors();
    const cache = new Map<string, Schedule>();
    const keys: string[] = [];
    for (let k = from; k <= to; k = dateKey(new Date(toDate(k).getTime() + 86_400_000))) keys.push(k);
    for (const id of employeeIds) {
      const employee = employees.get(id);
      if (!employee) continue;
      const schedule = await this.scheduleOf(id, cache);
      const holidays = this.holidaysFor(employee, holidayRows, ancestors);
      for (const k of keys) {
        const required = holidays.has(k) ? 0 : (schedule?.required[toDate(k).getUTCDay()] ?? 0);
        result.set(`${id}|${k}`, required);
      }
    }
    return result;
  }

  // Heures supplementaires affichees sur les feuilles de temps : au-dela de 40 h
  // cumulees dans la semaine, comme la paie. Les cadres n'en ont pas.
  private async weeklyOvertime(employeeIds: string[], from: string, to: string): Promise<Map<string, number>> {
    const result = new Map<string, number>();
    if (employeeIds.length === 0) return result;
    const monday = mondayOf(from);
    const wanted = new Set(employeeIds);
    // Un seul employe : lecture ciblee. Sinon toute la periode (bornee par l'effectif).
    const only = employeeIds.length === 1 ? employeeIds : undefined;
    const [rows, records, settings, employees, holidayRows, ancestors] = await Promise.all([
      this.prisma.timeDailyHours.findMany({
        where: { Date: { gte: toDate(monday), lte: toDate(to) }, ...(only ? { EmployeeId: { in: only } } : {}) },
        select: { EmployeeId: true, Date: true, WorkedHours: true },
      }),
      this.loadWorkRecords(monday, to, only),
      this.loadSettings(),
      this.loadEmployees(employeeIds),
      this.loadHolidayRows(monday, to),
      this.loadOrganizationAncestors(),
    ]);
    const days = new Map<string, DayHours[]>();
    for (const r of rows) {
      if (!wanted.has(r.EmployeeId)) continue;
      if (!days.has(r.EmployeeId)) days.set(r.EmployeeId, []);
      days.get(r.EmployeeId)!.push({ employeeId: r.EmployeeId, dateKey: dateKey(r.Date), workedHours: Number(r.WorkedHours), requiredHours: 0 });
    }
    const clocks = new Map<string, ClockRecord[]>();
    for (const c of records.values()) {
      if (!clocks.has(c.employeeId)) clocks.set(c.employeeId, []);
      clocks.get(c.employeeId)!.push(c);
    }
    for (const [id, list] of days) {
      const employee = employees.get(id);
      if (!employee || employee.isCadre) continue;
      const holidays = this.holidaysFor(employee, holidayRows, ancestors);
      for (const [key, hours] of weeklyOvertimeByDay(list, clocks.get(id) ?? [], holidays, settings)) {
        result.set(key, hours);
      }
    }
    return result;
  }

  // Synthese par employe sur une periode (heures prevues, travaillees, heures
  // supplementaires, absences, heures payees par code). employeeIds = null pour
  // tous les employes actifs. Lignes de calcul etroites : leur nombre est borne
  // par l'effectif x la periode, pas par l'historique.
  async timesheetSummary(
    from: string,
    to: string,
    employeeIds: string[] | null,
    opts: { search?: string; page?: number; pageSize?: number },
  ) {
    assertRange(from, to);
    const search = opts.search?.trim();
    const employees = await this.prisma.employee.findMany({
      where: {
        IsDeleted: false,
        IsSystem: false,
        Status: { in: ['Active', 'OnTrial'] },
        ...(employeeIds ? { Id: { in: employeeIds } } : {}),
        ...(search ? { OR: [{ FullName: { contains: search } }, { EmployeeNumber: { contains: search } }] } : {}),
      },
      select: { Id: true, FullName: true, EmployeeNumber: true },
      orderBy: [{ FullName: 'asc' }, { Id: 'asc' }],
    });
    const wanted = new Set(employees.map((e) => e.Id));
    const [days, overtime] = await Promise.all([
      this.prisma.timeDailyHours.findMany({
        where: { Date: { gte: toDate(from), lte: toDate(to) } },
        select: { EmployeeId: true, Date: true, WorkedHours: true },
      }),
      this.prisma.timeOvertime.findMany({
        where: { Date: { gte: toDate(from), lte: toDate(to) }, ...OVERTIME_ONLY },
        select: { EmployeeId: true, Hours: true },
      }),
    ]);
    const acc = new Map<string, { required: number; worked: number; overtime: number; absence: number; paidOvertime: number }>();
    const row = (id: string) => {
      let r = acc.get(id);
      if (!r) acc.set(id, (r = { required: 0, worked: 0, overtime: 0, absence: 0, paidOvertime: 0 }));
      return r;
    };
    const requiredMap = await this.requiredPerDay(employees.map((e) => e.Id), from, to);
    const overtimeMap = await this.weeklyOvertime(employees.map((e) => e.Id), from, to);
    const workedMap = new Map<string, number>();
    for (const d of days) {
      if (wanted.has(d.EmployeeId)) workedMap.set(`${d.EmployeeId}|${dateKey(d.Date)}`, Number(d.WorkedHours));
    }
    for (const e of employees) {
      const r = row(e.Id);
      for (let k = from; k <= to; k = dateKey(new Date(toDate(k).getTime() + 86_400_000))) {
        const required = requiredMap.get(`${e.Id}|${k}`) ?? 0;
        const worked = workedMap.get(`${e.Id}|${k}`) ?? 0;
        r.required += required;
        r.worked += worked;
        r.overtime += overtimeMap.get(`${e.Id}|${k}`) ?? 0;
        r.absence += Math.max(0, required - worked);
      }
    }
    for (const o of overtime) {
      if (wanted.has(o.EmployeeId)) row(o.EmployeeId).paidOvertime += Number(o.Hours);
    }
    const items = employees.map((e) => {
      const r = acc.get(e.Id) ?? { required: 0, worked: 0, overtime: 0, absence: 0, paidOvertime: 0 };
      return {
        employeeId: e.Id,
        employeeNumber: e.EmployeeNumber,
        name: e.FullName,
        required: round2(r.required),
        worked: round2(r.worked),
        overtime: round2(r.overtime),
        absence: round2(r.absence),
        paidOvertime: round2(r.paidOvertime),
        presenceRate: r.required > 0 ? round2(Math.min(100, (r.worked / r.required) * 100)) : null,
      };
    });
    const total = (f: (r: (typeof items)[number]) => number) => round2(items.reduce((s, r) => s + f(r), 0));
    const page = Math.max(1, opts.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, opts.pageSize ?? 20));
    return {
      items: items.slice((page - 1) * pageSize, page * pageSize),
      total: items.length,
      meta: {
        period: { from, to },
        totals: { required: total((r) => r.required), worked: total((r) => r.worked), overtime: total((r) => r.overtime), absence: total((r) => r.absence), paidOvertime: total((r) => r.paidOvertime) },
      },
    };
  }

  async timesheet(employeeId: string, from: string, to: string) {
    assertRange(from, to);
    const found = await this.prisma.employee.findUnique({
      where: { Id: employeeId },
      select: { Id: true, FullName: true, EmployeeNumber: true, organizationUnit: { select: { Name: true } } },
    });
    if (!found) throw new BadRequestException('Employé introuvable');
    // Service = entite de rattachement (affiche sur la feuille de temps en PDF).
    const employee = { Id: found.Id, FullName: found.FullName, EmployeeNumber: found.EmployeeNumber, Service: found.organizationUnit?.Name ?? null };
    const [days, records, overtimeMap] = await Promise.all([
      this.prisma.timeDailyHours.findMany({ where: { EmployeeId: employeeId, Date: { gte: toDate(from), lte: toDate(to) } } }),
      this.loadWorkRecords(from, to, [employeeId]),
      this.weeklyOvertime([employeeId], from, to),
    ]);
    const dayByKey = new Map(days.map((d) => [dateKey(d.Date), d]));
    const requiredMap = await this.requiredPerDay([employeeId], from, to);
    const raw: { required: number; worked: number; overtime: number; absence: number }[] = [];
    const rows: {
      date: string; required: number; worked: number; overtime: number; absence: number;
      in: string | null; out: string | null; travelMinutes: number;
    }[] = [];
    let cursor = from;
    while (cursor <= to) {
      const d = dayByKey.get(cursor);
      const required = requiredMap.get(`${employeeId}|${cursor}`) ?? 0;
      const worked = d ? Number(d.WorkedHours) : 0;
      const record = records.get(`${employeeId}|${cursor}`);
      // Heures telles que pointees (avant le trajet) ; une saisie en duree seule n'en a pas.
      const c = record?.badge ?? (record?.intervals?.length ? { start: record.firstClock, end: record.lastClock } : null);
      const overtime = overtimeMap.get(`${employeeId}|${cursor}`) ?? 0;
      raw.push({ required, worked, overtime, absence: Math.max(0, required - worked) });
      rows.push({
        date: cursor,
        required: round2(required),
        worked: round2(worked),
        overtime: round2(overtime),
        absence: round2(Math.max(0, required - worked)),
        in: c && c.end > c.start ? c.start.toISOString() : null,
        out: c && c.end > c.start ? c.end.toISOString() : null,
        travelMinutes: Math.round((record?.travelHours ?? 0) * 60),
      });
      cursor = dateKey(new Date(toDate(cursor).getTime() + 86_400_000));
    }
    // Totaux sur les valeurs non arrondies puis arrondis une seule fois (comme Pointage).
    const sum = (f: (r: (typeof raw)[number]) => number) => round2(raw.reduce((s, r) => s + f(r), 0));
    return {
      employee,
      period: { from, to },
      summary: { required: sum((r) => r.required), worked: sum((r) => r.worked), overtime: sum((r) => r.overtime), absence: sum((r) => r.absence) },
      days: rows,
    };
  }
}

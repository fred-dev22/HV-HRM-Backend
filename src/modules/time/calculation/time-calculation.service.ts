import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { CalendarService } from '../../calendar/calendar.service';
import {
  DEFAULT_TIME_SETTINGS,
  OvertimeMethod,
  methodSettingOf,
  PermanenceRates,
  SageSourceLine,
  TimeCalcSettings,
  buildSageRows,
  computeDailyHours,
  computeOvertimeLines,
  computePanierDays,
  computePermanenceLines,
  mondayOf,
  requiredHoursOfSchedule,
  round2,
  type ClockRecord,
  type DayHours,
} from './overtime-engine';

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;
const PANIER_CODE = '30900';
const PERMANENCE_CODE = '2210';

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
}

interface EmployeeContext {
  id: string;
  employeeNumber: string;
  gender: string;
  isExpatriate: boolean;
  isCadre: boolean;
  organizationUnitId: string;
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
    };
  }

  private async loadPermanenceRates(): Promise<PermanenceRates> {
    const rows = await this.prisma.timePermanenceRate.findMany();
    const rate = (type: string) => Number(rows.find((r) => r.DayType === type)?.Amount ?? 0);
    return { OUVRABLE: rate('OUVRABLE'), SAMEDI: rate('SAMEDI'), DIMANCHE_FERIE: rate('DIMANCHE_FERIE') };
  }

  private async loadEmployees(ids?: string[]): Promise<Map<string, EmployeeContext>> {
    const rows = await this.prisma.employee.findMany({
      where: { IsDeleted: false, ...(ids ? { Id: { in: ids } } : {}) },
      select: {
        Id: true,
        EmployeeNumber: true,
        Gender: true,
        IsExpatriate: true,
        IsCadre: true,
        OrganizationUnitId: true,
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
        },
      ]),
    );
  }

  // Ascendants de chaque entite (elle-meme incluse), pour les jours feries
  // cibles sur une entite.
  private async loadOrganizationAncestors(): Promise<Map<string, Set<string>>> {
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
  private async loadHolidayRows(from: string, to: string) {
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

  private holidaysFor(
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

  // Heures prevues par jour de semaine (0 = dimanche) pour un employe, d'apres
  // son calendrier (employe > categorie > global). null = pas de calendrier.
  private async scheduleOf(
    employeeId: string,
    cache: Map<string, { required: (number | null)[]; breakHours: number[] }>,
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
    const breakHours: number[] = Array(7).fill(0);
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
      if (day.breakStart && day.breakEnd) {
        const [bh, bm] = day.breakStart.split(':').map(Number);
        const [eh, em] = day.breakEnd.split(':').map(Number);
        breakHours[idx] = (eh! * 60 + em! - (bh! * 60 + bm!)) / 60;
      }
    }
    const value = { required, breakHours };
    cache.set(calendar.Id, value);
    return value;
  }

  // ── T4 : heures du jour ───────────────────────────────────────────────────

  // Corrections optionnelles, reglees dans TimeSetting (0/1) ; un parametre
  // explicite de l'appel les remplace.
  private async loadCorrections(override: { deductBreak?: boolean; includeNonWorkingDays?: boolean }) {
    const rows = await this.prisma.timeSetting.findMany({ where: { Key: { in: ['deduct_break', 'include_non_working_days'] } } });
    const flag = (key: string) => Number(rows.find((r) => r.Key === key)?.Value ?? 0) === 1;
    return {
      deductBreak: override.deductBreak ?? flag('deduct_break'),
      includeNonWorkingDays: override.includeNonWorkingDays ?? flag('include_non_working_days'),
    };
  }

  async calculateDailyHours(
    from: string,
    to: string,
    override: { deductBreak?: boolean; includeNonWorkingDays?: boolean } = {},
  ): Promise<DailyHoursResult> {
    assertRange(from, to);
    const { deductBreak, includeNonWorkingDays } = await this.loadCorrections(override);
    const records = await this.prisma.timeMorphoRecord.findMany({
      where: { EmployeeId: { not: null }, DateJour: { gte: toDate(from), lte: toDate(to) } },
      select: { EmployeeId: true, DateJour: true, PremierPointage: true, DernierPointage: true },
    });

    // Plusieurs lignes le meme jour (fichiers qui se recouvrent) : on garde le
    // premier pointage le plus tot et le dernier le plus tard.
    const merged = new Map<string, ClockRecord>();
    for (const r of records) {
      const key = `${r.EmployeeId}|${dateKey(r.DateJour)}`;
      const existing = merged.get(key);
      if (!existing) {
        merged.set(key, {
          employeeId: r.EmployeeId!,
          dateKey: dateKey(r.DateJour),
          firstClock: r.PremierPointage,
          lastClock: r.DernierPointage,
        });
      } else {
        if (r.PremierPointage < existing.firstClock) existing.firstClock = r.PremierPointage;
        if (r.DernierPointage > existing.lastClock) existing.lastClock = r.DernierPointage;
      }
    }

    const employees = await this.loadEmployees(Array.from(new Set(Array.from(merged.values()).map((m) => m.employeeId))));
    const holidayRows = await this.loadHolidayRows(from, to);
    const ancestors = await this.loadOrganizationAncestors();
    const scheduleCache = new Map<string, { required: (number | null)[]; breakHours: number[] }>();

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
        (_e, key) => schedule.breakHours[dow(key)] ?? 0,
        { deductBreak, includeNonWorkingDays },
      );
      days.push(...result.days);
      skipped += result.skipped;
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.timeDailyHours.deleteMany({ where: { Date: { gte: toDate(from), lte: toDate(to) } } });
      for (let i = 0; i < days.length; i += 500) {
        await tx.timeDailyHours.createMany({
          data: days.slice(i, i + 500).map((d) => ({
            EmployeeId: d.employeeId,
            Date: toDate(d.dateKey),
            WorkedHours: round2(d.workedHours),
            RequiredHours: d.requiredHours,
          })),
        });
      }
    });

    return { calculated: days.length, skipped, employeesWithoutCalendar, period: { from, to } };
  }

  // ── T5 : heures supplementaires, panier, permanence ───────────────────────

  // Methode retenue : celle du reglage client. Avec "les deux", la methode
  // demandee est utilisee (journalier par defaut) ; avec une methode fixe, une
  // demande differente est refusee plutot que d'etre ignoree en silence, car elle
  // change la paie.
  private async resolveMethod(requested?: OvertimeMethod): Promise<OvertimeMethod> {
    const row = await this.prisma.timeSetting.findUnique({ where: { Key: 'overtime_method' } });
    const setting = methodSettingOf(row ? Number(row.Value) : undefined);
    if (setting === 'both') return requested ?? 'daily';
    if (requested && requested !== setting) {
      throw new BadRequestException(
        `Le calcul est réglé sur la méthode ${setting === 'daily' ? 'journalière' : 'hebdomadaire'} (Configuration > Réglages).`,
      );
    }
    return setting;
  }

  async calculateOvertime(from: string, to: string, requestedMethod?: OvertimeMethod): Promise<OvertimeResult> {
    assertRange(from, to);
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
    const clockRows = await this.prisma.timeMorphoRecord.findMany({
      where: { EmployeeId: { not: null }, DateJour: { gte: toDate(widenedFrom), lte: toDate(to) } },
      select: { EmployeeId: true, DateJour: true, PremierPointage: true, DernierPointage: true },
    });

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

    const merged = new Map<string, ClockRecord>();
    for (const r of clockRows) {
      const key = `${r.EmployeeId}|${dateKey(r.DateJour)}`;
      const e = merged.get(key);
      if (!e) {
        merged.set(key, { employeeId: r.EmployeeId!, dateKey: dateKey(r.DateJour), firstClock: r.PremierPointage, lastClock: r.DernierPointage });
      } else {
        if (r.PremierPointage < e.firstClock) e.firstClock = r.PremierPointage;
        if (r.DernierPointage > e.lastClock) e.lastClock = r.DernierPointage;
      }
    }

    const rates = await this.loadPermanenceRates();
    const out: { employeeId: string; dateKey: string; code: string; hours: number }[] = [];
    let excludedCadres = 0;

    const employeeIds = new Set([...dailyRows.map((d) => d.EmployeeId), ...approved.map((a) => a.EmployeeId)]);
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
        .filter((d) => d.EmployeeId === employeeId)
        .map((d) => ({
          employeeId,
          dateKey: dateKey(d.Date),
          workedHours: Number(d.WorkedHours),
          requiredHours: Number(d.RequiredHours),
        }));
      const clocks = Array.from(merged.values()).filter((c) => c.employeeId === employeeId);

      for (const l of computeOvertimeLines({ days, clocks, holidays, settings, method, from, to })) {
        out.push({ employeeId, dateKey: l.dateKey, code: l.category, hours: l.hours });
      }

      const mine = approved.filter((a) => a.EmployeeId === employeeId);
      const manualPanier = mine
        .filter((a) => a.EntryType === 'panier')
        .map((a) => ({ employeeId, dateKey: dateKey(a.Date) }));
      for (const p of computePanierDays(days, manualPanier, settings.panierMinHours, from, to)) {
        out.push({ employeeId, dateKey: p.dateKey, code: PANIER_CODE, hours: 1 });
      }
      const permanence = mine
        .filter((a) => a.EntryType === 'permanence')
        .map((a) => ({ employeeId, dateKey: dateKey(a.Date) }));
      for (const p of computePermanenceLines(permanence, holidays, rates)) {
        out.push({ employeeId, dateKey: p.dateKey, code: PERMANENCE_CODE, hours: p.amount });
      }
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.timeOvertime.deleteMany({ where: { Date: { gte: toDate(from), lte: toDate(to) } } });
      for (let i = 0; i < out.length; i += 500) {
        await tx.timeOvertime.createMany({
          data: out.slice(i, i + 500).map((l) => ({
            EmployeeId: l.employeeId,
            CodeId: codeId.get(l.code)!,
            Date: toDate(l.dateKey),
            Hours: l.hours,
          })),
        });
      }
    });

    const breakdown: Record<string, number> = {};
    for (const l of out) breakdown[l.code] = round2((breakdown[l.code] ?? 0) + l.hours);
    return { calculated: out.length, excludedCadres, breakdown, method, period: { from, to } };
  }

  // ── Lecture : rapport et export Sage ──────────────────────────────────────

  async overtimeReport(from: string, to: string, employeeIds?: string[]) {
    assertRange(from, to);
    const rows = await this.prisma.timeOvertime.findMany({
      where: {
        Date: { gte: toDate(from), lte: toDate(to) },
        ...(employeeIds ? { EmployeeId: { in: employeeIds } } : {}),
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
      where: { Date: { gte: toDate(from), lte: toDate(to) } },
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
        select: { EmployeeId: true, WorkedHours: true, RequiredHours: true },
      }),
      this.prisma.timeOvertime.findMany({
        where: { Date: { gte: toDate(from), lte: toDate(to) } },
        select: { EmployeeId: true, Hours: true },
      }),
    ]);
    const acc = new Map<string, { required: number; worked: number; overtime: number; absence: number; paidOvertime: number }>();
    const row = (id: string) => {
      let r = acc.get(id);
      if (!r) acc.set(id, (r = { required: 0, worked: 0, overtime: 0, absence: 0, paidOvertime: 0 }));
      return r;
    };
    for (const d of days) {
      if (!wanted.has(d.EmployeeId)) continue;
      const required = Number(d.RequiredHours);
      const worked = Number(d.WorkedHours);
      const r = row(d.EmployeeId);
      r.required += required;
      r.worked += worked;
      r.overtime += Math.max(0, worked - required);
      r.absence += Math.max(0, required - worked);
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
    const employee = await this.prisma.employee.findUnique({
      where: { Id: employeeId },
      select: { Id: true, FullName: true, EmployeeNumber: true },
    });
    if (!employee) throw new BadRequestException('Employé introuvable');
    const [days, clocks] = await Promise.all([
      this.prisma.timeDailyHours.findMany({ where: { EmployeeId: employeeId, Date: { gte: toDate(from), lte: toDate(to) } } }),
      this.prisma.timeMorphoRecord.findMany({
        where: { EmployeeId: employeeId, DateJour: { gte: toDate(from), lte: toDate(to) } },
        orderBy: { PremierPointage: 'asc' },
      }),
    ]);
    const dayByKey = new Map(days.map((d) => [dateKey(d.Date), d]));
    const clockByKey = new Map<string, { in: Date; out: Date }>();
    for (const c of clocks) {
      const k = dateKey(c.DateJour);
      const e = clockByKey.get(k);
      if (!e) clockByKey.set(k, { in: c.PremierPointage, out: c.DernierPointage });
      else {
        if (c.PremierPointage < e.in) e.in = c.PremierPointage;
        if (c.DernierPointage > e.out) e.out = c.DernierPointage;
      }
    }
    const rows: { date: string; required: number; worked: number; overtime: number; absence: number; in: string | null; out: string | null }[] = [];
    let cursor = from;
    while (cursor <= to) {
      const d = dayByKey.get(cursor);
      const required = d ? Number(d.RequiredHours) : 0;
      const worked = d ? Number(d.WorkedHours) : 0;
      const c = clockByKey.get(cursor);
      rows.push({
        date: cursor,
        required,
        worked,
        overtime: round2(Math.max(0, worked - required)),
        absence: round2(Math.max(0, required - worked)),
        in: c ? c.in.toISOString() : null,
        out: c ? c.out.toISOString() : null,
      });
      cursor = dateKey(new Date(toDate(cursor).getTime() + 86_400_000));
    }
    const sum = (f: (r: (typeof rows)[number]) => number) => round2(rows.reduce((s, r) => s + f(r), 0));
    return {
      employee,
      period: { from, to },
      summary: { required: sum((r) => r.required), worked: sum((r) => r.worked), overtime: sum((r) => r.overtime), absence: sum((r) => r.absence) },
      days: rows,
    };
  }
}

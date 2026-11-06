// Moteur de calcul du temps de travail : fonctions pures, sans acces base ni
// horloge. Reprise fidele des regles du systeme Pointage (payroll.service.ts)
// pour que le resultat soit comparable ligne a ligne avec ses `overtimes`.
//
// Regles (reunion client 2026-07, demande client 2026-09) :
//  - HS01 (130 %) / HS02 (150 %) : les 8 premieres heures supplementaires de la
//    semaine (lundi-dimanche) a 130 %, le reste a 150 %. Le samedi suit la
//    repartition normale.
//  - HS03 / HS04 : memes taux, reserves aux 20 premieres heures supplementaires
//    du MOIS calendaire (non imposables), consommees du plus ancien au plus
//    recent, apres la repartition hebdomadaire, sur HS01/HS02 uniquement.
//  - HS09 (nuit) et HS10 (dimanche/ferie) sont des MAJORATIONS : elles portent
//    sur toutes les heures travaillees dans le creneau, pas seulement sur le
//    depassement. Un dimanche/ferie est exclu du pool HS01-04. Les heures de
//    nuit sont retirees du pool HS01-04 pour ne jamais valoriser deux fois la
//    meme heure.
//  - Panier : 1 par jour dont la duree travaillee atteint le seuil, plus les
//    saisies manuelles validees, dedoublonnees par employe et par jour.
//  - Permanence : montant selon le type de jour, jamais derive du pointage.
//
// Jours : cles 'YYYY-MM-DD' ; jour de semaine et semaines calcules en UTC.
// Heures de pointage : objets Date, la fenetre de nuit est lue en heure locale
// du serveur (comme le systeme Pointage).

export type OvertimeMethod = 'daily' | 'weekly';

// Reglage client (TimeSetting overtime_method) : 0 = journalier, 1 = hebdomadaire,
// 2 = les deux methodes sont proposees et la methode se choisit a chaque calcul.
// Absent ou inconnu : journalier (methode historique de Pointage).
export type OvertimeMethodSetting = OvertimeMethod | 'both';
export function methodSettingOf(value: number | null | undefined): OvertimeMethodSetting {
  if (value === 1) return 'weekly';
  if (value === 2) return 'both';
  return 'daily';
}

export type OvertimeCategory = 'HS01' | 'HS02' | 'HS03' | 'HS04' | 'HS09' | 'HS10';

export interface TimeCalcSettings {
  panierMinHours: number;
  nightStartHour: number;
  nightEndHour: number;
  weeklyHs01ThresholdHours: number;
  monthlyNiCapHours: number;
  // 1 = plafond partage par toute l'entreprise (comme le systeme Pointage), 0 = propre a chaque employe.
  monthlyNiCapCompanyWide: boolean;
}

// Valeurs d'usine, identiques au seed (TIME_SETTINGS).
export const DEFAULT_TIME_SETTINGS: TimeCalcSettings = {
  panierMinHours: 8,
  nightStartHour: 22,
  nightEndHour: 5,
  weeklyHs01ThresholdHours: 8,
  monthlyNiCapHours: 20,
  monthlyNiCapCompanyWide: true,
};

// Seuil hebdomadaire de la methode 'weekly' (code en dur dans le systeme
// Pointage : au-dela de 40 h travaillees dans la semaine).
export const WEEKLY_PAID_HOURS = 40;

export interface DayHours {
  employeeId: string;
  dateKey: string;
  workedHours: number;
  requiredHours: number;
}

export interface ClockRecord {
  employeeId: string;
  dateKey: string;
  firstClock: Date;
  lastClock: Date;
}

export interface OvertimeLine {
  employeeId: string;
  dateKey: string;
  hours: number;
  category: OvertimeCategory;
}

export interface PermanenceEntry {
  employeeId: string;
  dateKey: string;
}

export type PermanenceRates = { OUVRABLE: number; SAMEDI: number; DIMANCHE_FERIE: number };

export interface PermanenceLine {
  employeeId: string;
  dateKey: string;
  amount: number;
}

export interface PanierLine {
  employeeId: string;
  dateKey: string;
}

export const round2 = (n: number): number => Math.round(n * 100) / 100;

// ── Dates ───────────────────────────────────────────────────────────────────

export function dayOfWeek(dateKey: string): number {
  return new Date(`${dateKey}T00:00:00Z`).getUTCDay(); // 0 = dimanche
}

export function addDays(dateKey: string, days: number): string {
  const d = new Date(`${dateKey}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// Lundi de la semaine (lundi-dimanche) qui contient la date.
export function mondayOf(dateKey: string): string {
  const dow = dayOfWeek(dateKey);
  return addDays(dateKey, dow === 0 ? -6 : 1 - dow);
}

export function* eachDateKey(from: string, to: string): Generator<string> {
  let current = from;
  while (current <= to) {
    yield current;
    current = addDays(current, 1);
  }
}

// ── T4 : heures du jour ─────────────────────────────────────────────────────

// Heures prevues par un horaire de jour. Arrondi au dixieme, pause deduite.
// null si le jour n'est pas travaille ou si l'horaire est incomplet.
export function requiredHoursOfSchedule(day: {
  isWorkingDay: boolean;
  startTime: string | null;
  endTime: string | null;
  breakStart?: string | null;
  breakEnd?: string | null;
}): number | null {
  if (!day.isWorkingDay || !day.startTime || !day.endTime) return null;
  const toMinutes = (t: string) => {
    const [h, m] = t.split(':').map(Number);
    return h! * 60 + (m ?? 0);
  };
  let minutes = toMinutes(day.endTime) - toMinutes(day.startTime);
  if (day.breakStart && day.breakEnd) minutes -= toMinutes(day.breakEnd) - toMinutes(day.breakStart);
  return Math.round((minutes / 60) * 10) / 10;
}

export interface DailyHoursOptions {
  // Duree de pause (heures) a retirer du temps travaille quand la journee
  // couvre la pause. Le systeme Pointage ne la retire pas (le temps travaille
  // est dernier - premier pointage) : defaut false pour rester identique tant
  // que le client n'a pas valide la correction.
  deductBreak?: boolean;
  // Jour sans horaire (dimanche, jour non travaille) mais pointe : le systeme
  // Pointage l'ignore, donc perd les heures du dimanche (HS10). Vrai = on le
  // garde avec 0 heure prevue. Defaut false pour rester identique.
  includeNonWorkingDays?: boolean;
}

// Une ligne par employe et par jour pointe. `requiredFor` renvoie les heures
// prevues du jour (null = pas d'horaire / jour non travaille : le pointage est
// ignore, comme dans le systeme Pointage). Un jour ferie vaut 0 heure prevue.
export function computeDailyHours(
  records: ClockRecord[],
  holidays: Set<string>,
  requiredFor: (employeeId: string, dateKey: string) => number | null,
  breakHoursFor?: (employeeId: string, dateKey: string) => number,
  options: DailyHoursOptions = {},
): { days: DayHours[]; skipped: number } {
  const days: DayHours[] = [];
  let skipped = 0;
  for (const r of records) {
    let required = holidays.has(r.dateKey) ? 0 : requiredFor(r.employeeId, r.dateKey);
    if (required === null && options.includeNonWorkingDays) required = 0;
    if (required === null) {
      skipped++;
      continue;
    }
    let worked = (r.lastClock.getTime() - r.firstClock.getTime()) / 3_600_000;
    if (options.deductBreak && breakHoursFor) {
      const pause = breakHoursFor(r.employeeId, r.dateKey);
      if (worked > pause) worked -= pause;
    }
    days.push({ employeeId: r.employeeId, dateKey: r.dateKey, workedHours: worked, requiredHours: required });
  }
  return { days, skipped };
}

// ── T5 : heures supplementaires ─────────────────────────────────────────────

// Nuit = chevauchement de [premier, dernier pointage] avec [jour 22:00, jour+1 05:00).
export function nightOverlapHours(first: Date, last: Date, dateKey: string, startHour: number, endHour: number): number {
  const [y, m, d] = dateKey.split('-').map(Number);
  const nightStart = new Date(y!, m! - 1, d!, startHour, 0, 0, 0);
  const nightEnd = new Date(y!, m! - 1, d! + 1, endHour, 0, 0, 0);
  const start = Math.max(first.getTime(), nightStart.getTime());
  const end = Math.min(last.getTime(), nightEnd.getTime());
  if (end <= start) return 0;
  return (end - start) / 3_600_000;
}

export interface OvertimeInput {
  // Jours deja filtres sur les employes eligibles (cadres exclus).
  days: DayHours[];
  clocks: ClockRecord[];
  holidays: Set<string>;
  settings: TimeCalcSettings;
  method: OvertimeMethod;
  from: string;
  to: string;
}

// Plafond mensuel non imposable : consomme du plus ancien au plus recent, par
// mois calendaire, sur HS01/HS02 uniquement (converties en HS03/HS04). Une
// ligne est scindee si le plafond tombe en son milieu. Modifie `lines`.
export function applyMonthlyNiCap(lines: OvertimeLine[], monthlyCapHours: number, companyWide = false, rank?: Map<string, number>): void {
  const byMonth = new Map<string, OvertimeLine[]>();
  for (const line of lines) {
    if (line.category !== 'HS01' && line.category !== 'HS02') continue;
    // Portee du plafond : toute l'entreprise (comme Pointage) ou chaque employe.
    const month = line.dateKey.slice(0, 7);
    const key = companyWide ? month : `${line.employeeId}|${month}`;
    if (!byMonth.has(key)) byMonth.set(key, []);
    byMonth.get(key)!.push(line);
  }
  for (const monthLines of byMonth.values()) {
    monthLines.sort((a, b) =>
      a.dateKey !== b.dateKey
        ? a.dateKey < b.dateKey ? -1 : 1
        : (rank?.get(a.employeeId) ?? 0) - (rank?.get(b.employeeId) ?? 0) ||
          (a.employeeId < b.employeeId ? -1 : a.employeeId > b.employeeId ? 1 : 0),
    );
    let remaining = monthlyCapHours;
    for (const line of monthLines) {
      if (remaining <= 0) break;
      const convertible = Math.min(line.hours, remaining);
      if (convertible <= 0) continue;
      const niCategory: OvertimeCategory = line.category === 'HS01' ? 'HS03' : 'HS04';
      if (convertible === line.hours) {
        line.category = niCategory;
      } else {
        lines.push({ employeeId: line.employeeId, dateKey: line.dateKey, hours: convertible, category: niCategory });
        line.hours -= convertible;
      }
      remaining -= convertible;
    }
  }
}

function groupByEmployeeWeek(days: DayHours[]): Map<string, Map<string, DayHours[]>> {
  const byEmployee = new Map<string, Map<string, DayHours[]>>();
  for (const dh of days) {
    if (!byEmployee.has(dh.employeeId)) byEmployee.set(dh.employeeId, new Map());
    const weeks = byEmployee.get(dh.employeeId)!;
    const week = mondayOf(dh.dateKey);
    if (!weeks.has(week)) weeks.set(week, []);
    weeks.get(week)!.push(dh);
  }
  return byEmployee;
}

function clockIndex(clocks: ClockRecord[]): Map<string, ClockRecord> {
  const index = new Map<string, ClockRecord>();
  for (const c of clocks) index.set(`${c.employeeId}|${c.dateKey}`, c);
  return index;
}

// Lignes HS01-HS04, HS09, HS10 d'une periode. Methode 'daily' : depassement de
// l'horaire du jour, cumule sur la semaine. Methode 'weekly' : cumul de la
// semaine au-dela de 40 h (hors dimanche/ferie et heures de nuit) ; l'appelant
// doit alors fournir les jours depuis le lundi de la semaine de `from`, et une
// semaine n'est close que si son dimanche tombe dans la periode.
export function computeOvertimeLines(input: OvertimeInput): OvertimeLine[] {
  const { days, clocks, holidays, settings, method, from, to } = input;
  const clockByDay = clockIndex(clocks);
  const lines: OvertimeLine[] = [];

  for (const [employeeId, weeks] of groupByEmployeeWeek(days)) {
    for (const [weekMonday, weekDays] of weeks) {
      weekDays.sort((a, b) => (a.dateKey < b.dateKey ? -1 : a.dateKey > b.dateKey ? 1 : 0));
      let weeklyOvertime = 0; // methode 'daily'
      let weeklyPool = 0; // methode 'weekly'

      for (const dh of weekDays) {
        const special = holidays.has(dh.dateKey) || dayOfWeek(dh.dateKey) === 0;
        const inPeriod = dh.dateKey >= from && dh.dateKey <= to;

        if (special) {
          if (inPeriod && dh.workedHours > 0) {
            lines.push({ employeeId, dateKey: dh.dateKey, hours: dh.workedHours, category: 'HS10' });
          }
          continue;
        }

        const clock = clockByDay.get(`${employeeId}|${dh.dateKey}`);
        const night = clock
          ? nightOverlapHours(clock.firstClock, clock.lastClock, dh.dateKey, settings.nightStartHour, settings.nightEndHour)
          : 0;
        if (night > 0 && inPeriod) {
          lines.push({ employeeId, dateKey: dh.dateKey, hours: night, category: 'HS09' });
        }

        if (method === 'weekly') {
          weeklyPool += Math.max(0, dh.workedHours - night);
          continue;
        }

        if (dh.workedHours <= dh.requiredHours) continue;
        const remaining = Math.max(0, dh.workedHours - dh.requiredHours - night);
        if (remaining <= 0) continue;
        const hs01Ceiling = Math.max(0, settings.weeklyHs01ThresholdHours - weeklyOvertime);
        const hs01 = Math.min(remaining, hs01Ceiling);
        const hs02 = remaining - hs01;
        weeklyOvertime += remaining;
        if (hs01 > 0) lines.push({ employeeId, dateKey: dh.dateKey, hours: hs01, category: 'HS01' });
        if (hs02 > 0) lines.push({ employeeId, dateKey: dh.dateKey, hours: hs02, category: 'HS02' });
      }

      if (method === 'weekly') {
        const weekEnd = addDays(weekMonday, 6);
        if (weekEnd > to) continue;
        const overtime = Math.max(0, weeklyPool - WEEKLY_PAID_HOURS);
        if (overtime <= 0) continue;
        const hs01 = Math.min(overtime, settings.weeklyHs01ThresholdHours);
        const hs02 = overtime - hs01;
        if (hs01 > 0) lines.push({ employeeId, dateKey: weekEnd, hours: hs01, category: 'HS01' });
        if (hs02 > 0) lines.push({ employeeId, dateKey: weekEnd, hours: hs02, category: 'HS02' });
      }
    }
  }

  // Plafond partage par l'entreprise : applique par l'appelant, une fois toutes les lignes de tous les employes connues.
  if (!settings.monthlyNiCapCompanyWide) applyMonthlyNiCap(lines, settings.monthlyNiCapHours, false);
  return lines;
}

// Paniers : un par employe et par jour, auto-calcule sur la duree travaillee
// plus les saisies manuelles validees (jamais deux lignes le meme jour).
export function computePanierDays(
  days: DayHours[],
  manualDays: PanierLine[],
  panierMinHours: number,
  from: string,
  to: string,
): PanierLine[] {
  const result = new Map<string, PanierLine>();
  for (const dh of days) {
    if (dh.dateKey < from || dh.dateKey > to) continue;
    if (dh.workedHours >= panierMinHours) {
      result.set(`${dh.employeeId}|${dh.dateKey}`, { employeeId: dh.employeeId, dateKey: dh.dateKey });
    }
  }
  for (const m of manualDays) {
    const key = `${m.employeeId}|${m.dateKey}`;
    if (!result.has(key)) result.set(key, m);
  }
  return Array.from(result.values());
}

export function permanenceAmount(dateKey: string, holidays: Set<string>, rates: PermanenceRates): number {
  if (holidays.has(dateKey) || dayOfWeek(dateKey) === 0) return rates.DIMANCHE_FERIE;
  if (dayOfWeek(dateKey) === 6) return rates.SAMEDI;
  return rates.OUVRABLE;
}

export function computePermanenceLines(
  entries: PermanenceEntry[],
  holidays: Set<string>,
  rates: PermanenceRates,
): PermanenceLine[] {
  return entries.map((e) => ({
    employeeId: e.employeeId,
    dateKey: e.dateKey,
    amount: permanenceAmount(e.dateKey, holidays, rates),
  }));
}

// ── Export Sage ─────────────────────────────────────────────────────────────

export interface SageSourceLine {
  employeeNumber: string;
  codeId: string;
  code: string;
  sageTypeCode: number | null;
  hours: number;
}

export interface SageRow {
  im: string;
  type: number;
  code: string;
  valeur: number;
}

// Total par matricule et par code. Leve si un type de presence n'a pas de code
// Sage : l'export serait inutilisable.
export function buildSageRows(lines: SageSourceLine[]): SageRow[] {
  const totals = new Map<string, { im: string; type: number | null; code: string; valeur: number }>();
  for (const l of lines) {
    const key = `${l.employeeNumber}|${l.codeId}`;
    if (!totals.has(key)) totals.set(key, { im: l.employeeNumber, type: l.sageTypeCode, code: l.code, valeur: 0 });
    totals.get(key)!.valeur += l.hours;
  }
  const rows = Array.from(totals.values());
  const missing = rows.filter((r) => r.type === null);
  if (missing.length > 0) {
    const codes = Array.from(new Set(missing.map((r) => r.code))).join(', ');
    throw new Error(`Code Sage manquant pour le(s) code(s) : ${codes}`);
  }
  return rows.map((r) => ({ im: r.im, type: r.type as number, code: r.code, valeur: round2(r.valeur) }));
}

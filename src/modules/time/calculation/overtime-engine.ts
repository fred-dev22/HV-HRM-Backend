// Moteur de calcul du temps de travail : fonctions pures, sans acces base ni
// horloge. Reprise fidele des regles du systeme Pointage (payroll.service.ts)
// pour que le resultat soit comparable ligne a ligne avec ses `overtimes`.
//
// Regles (reunion client 2026-07, demande client 2026-09) :
//  - HS01 (130 %) / HS02 (150 %) : les 8 premieres heures supplementaires de la
//    semaine (lundi-dimanche) a 130 %, le reste a 150 %. Le samedi suit la
//    repartition normale.
//  - HS03 / HS04 : memes taux, reserves aux 20 premieres heures supplementaires
//    du MOIS calendaire de CHAQUE employe (non imposables), consommees du plus
//    ancien au plus recent, apres la repartition hebdomadaire, sur HS01/HS02.
//  - HS09 (nuit) et HS10 (dimanche/ferie) sont des MAJORATIONS : elles portent
//    sur toutes les heures travaillees dans le creneau, pas seulement sur le
//    depassement. Un dimanche/ferie est exclu du pool HS01-04. Les heures de
//    nuit sont retirees du pool HS01-04 pour ne jamais valoriser deux fois la
//    meme heure.
//  - Panier : 1 par jour avec un service continu (sans pause) atteignant le
//    seuil, plus les saisies manuelles validees, dedoublonnees par employe et jour.
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
  // Panier seulement pour un service continu (sans pause) d'au moins le seuil.
  panierRequiresContinuous: boolean;
}

// Valeurs d'usine, identiques au seed (TIME_SETTINGS).
export const DEFAULT_TIME_SETTINGS: TimeCalcSettings = {
  panierMinHours: 8,
  nightStartHour: 22,
  nightEndHour: 5,
  weeklyHs01ThresholdHours: 8,
  monthlyNiCapHours: 20,
  monthlyNiCapCompanyWide: false,
  panierRequiresContinuous: true,
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

export interface Interval {
  start: Date;
  end: Date;
  // Travail hors du site (mission, reunion...) : aucun trajet n'en est retire.
  remote?: boolean;
}

export interface ClockRecord {
  employeeId: string;
  dateKey: string;
  firstClock: Date;
  lastClock: Date;
  // Plages travaillees disjointes (pointeuse et saisies). Absent : une seule
  // plage, du premier au dernier pointage.
  intervals?: Interval[];
  // Heures declarees sans horaires, ajoutees au temps travaille.
  extraHours?: number;
  // Le jour porte une saisie approuvee : compte meme hors des jours prevus.
  declared?: boolean;
  // Origine des plages, utile au panier : plage de la pointeuse et plages
  // saisies. Les deux absents : tout vient de la pointeuse.
  punch?: Interval;
  declaredIntervals?: Interval[];
  // Presents quand du temps de trajet a ete retire : heures de la pointeuse
  // telles quelles (pour l'affichage) et duree retiree.
  badge?: Interval;
  travelHours?: number;
}

export const intervalsOf = (r: ClockRecord): Interval[] => r.intervals ?? [{ start: r.firstClock, end: r.lastClock }];

const hoursBetween = (i: Interval): number => (i.end.getTime() - i.start.getTime()) / 3_600_000;

// Plages triees ; celles qui se recouvrent ou se touchent sont reunies, pour
// qu'une meme heure ne compte jamais deux fois.
export function mergeIntervals(intervals: Interval[]): Interval[] {
  const sorted = [...intervals].sort((a, b) => a.start.getTime() - b.start.getTime());
  const result: Interval[] = [];
  for (const current of sorted) {
    const last = result[result.length - 1];
    if (last && current.start.getTime() <= last.end.getTime()) {
      if (current.end > last.end) last.end = current.end;
    } else {
      result.push({ start: current.start, end: current.end });
    }
  }
  return result;
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
    if (required === null && (options.includeNonWorkingDays || r.declared)) required = 0;
    if (required === null) {
      skipped++;
      continue;
    }
    const intervals = intervalsOf(r);
    let worked = intervals.reduce((sum, i) => sum + hoursBetween(i), 0);
    if (options.deductBreak && breakHoursFor) {
      // Un trou entre deux plages est deja une pause : on ne la retire pas deux fois.
      const span = intervals.length ? hoursBetween({ start: r.firstClock, end: r.lastClock }) : 0;
      const pause = Math.max(0, breakHoursFor(r.employeeId, r.dateKey) - Math.max(0, span - worked));
      if (worked > pause) worked -= pause;
    }
    worked = Math.min(24, worked + (r.extraHours ?? 0));
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
  // Voir applyMonthlyNiCap (plafond par employe).
  niAlreadyUsed?: Map<string, number>;
}

// Plafond mensuel non imposable : consomme du plus ancien au plus recent, par
// mois calendaire, sur HS01/HS02 uniquement (converties en HS03/HS04). Une
// ligne est scindee si le plafond tombe en son milieu. Modifie `lines`.
// `alreadyUsed` : heures non imposables deja attribuees avant la periode calculee,
// par mois (`AAAA-MM`) si le plafond est partage, sinon par `employe|AAAA-MM`.
export function applyMonthlyNiCap(
  lines: OvertimeLine[],
  monthlyCapHours: number,
  companyWide = false,
  rank?: Map<string, number>,
  alreadyUsed?: Map<string, number>,
): void {
  const byMonth = new Map<string, OvertimeLine[]>();
  for (const line of lines) {
    if (line.category !== 'HS01' && line.category !== 'HS02') continue;
    // Portee du plafond : toute l'entreprise (comme Pointage) ou chaque employe.
    const month = line.dateKey.slice(0, 7);
    const key = companyWide ? month : `${line.employeeId}|${month}`;
    if (!byMonth.has(key)) byMonth.set(key, []);
    byMonth.get(key)!.push(line);
  }
  for (const [capKey, monthLines] of byMonth) {
    monthLines.sort((a, b) =>
      a.dateKey !== b.dateKey
        ? a.dateKey < b.dateKey ? -1 : 1
        : (rank?.get(a.employeeId) ?? 0) - (rank?.get(b.employeeId) ?? 0) ||
          (a.employeeId < b.employeeId ? -1 : a.employeeId > b.employeeId ? 1 : 0),
    );
    let remaining = monthlyCapHours - (alreadyUsed?.get(capKey) ?? 0);
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

// Retire le trajet et le changement de la presence sur site : `minutes` apres la
// premiere arrivee et `minutes` avant le dernier depart du jour (une seule fois,
// quel que soit le nombre de periodes). 07:00-17:30 avec 15 min devient
// 07:15-17:15. Les heures de nuit et supplementaires partent du resultat.
export function deductTravel(record: ClockRecord, minutes: number): ClockRecord {
  if (!minutes) return record;
  const punched = record.punch !== undefined || record.declaredIntervals !== undefined;
  const punch = punched ? record.punch : intervalsOf(record)[0];
  const declared = record.declaredIntervals ?? [];
  const onSite = [...(punch ? [punch] : []), ...declared].filter((i) => !i.remote && i.end > i.start);
  if (!onSite.length) return record;

  const from = Math.min(...onSite.map((i) => i.start.getTime())) + minutes * 60_000;
  const to = Math.max(...onSite.map((i) => i.end.getTime())) - minutes * 60_000;
  const clip = (i: Interval): Interval | null => {
    if (i.remote) return i;
    const start = Math.max(i.start.getTime(), from);
    const end = Math.min(i.end.getTime(), to);
    return end > start ? { start: new Date(start), end: new Date(end) } : null;
  };
  const newPunch = punch ? (clip(punch) ?? undefined) : undefined;
  const newDeclared = declared.map(clip).filter((i): i is Interval => i !== null);
  const before = mergeIntervals([...(punch ? [punch] : []), ...declared]);
  const intervals = mergeIntervals([...(newPunch ? [newPunch] : []), ...newDeclared]);
  const total = (list: Interval[]) => list.reduce((sum, i) => sum + hoursBetween(i), 0);
  const midnight = new Date(`${record.dateKey}T00:00:00`);
  return {
    ...record,
    punch: newPunch,
    declaredIntervals: newDeclared,
    intervals,
    firstClock: intervals[0]?.start ?? midnight,
    lastClock: intervals[intervals.length - 1]?.end ?? midnight,
    badge: { start: record.firstClock, end: record.lastClock },
    travelHours: total(before) - total(intervals),
  };
}

// Heures de nuit d'un jour, toutes plages confondues.
function nightHoursOf(record: ClockRecord | undefined, dateKey: string, settings: TimeCalcSettings): number {
  if (!record) return 0;
  return intervalsOf(record).reduce(
    (sum, i) => sum + nightOverlapHours(i.start, i.end, dateKey, settings.nightStartHour, settings.nightEndHour),
    0,
  );
}

const isSpecialDay = (dateKey: string, holidays: Set<string>) => holidays.has(dateKey) || dayOfWeek(dateKey) === 0;

// Heures supplementaires jour par jour, au-dela de 40 h cumulees dans la semaine
// (lundi-dimanche), pour la feuille de temps : meme base que le calcul de paie
// (dimanches, jours feries et heures de nuit exclus). `days` doit commencer au
// lundi de la premiere semaine affichee. Cle : `employe|AAAA-MM-JJ`.
export function weeklyOvertimeByDay(
  days: DayHours[],
  clocks: ClockRecord[],
  holidays: Set<string>,
  settings: TimeCalcSettings,
): Map<string, number> {
  const clockByDay = clockIndex(clocks);
  const result = new Map<string, number>();
  for (const [employeeId, weeks] of groupByEmployeeWeek(days)) {
    for (const weekDays of weeks.values()) {
      weekDays.sort((a, b) => (a.dateKey < b.dateKey ? -1 : a.dateKey > b.dateKey ? 1 : 0));
      let pool = 0;
      for (const dh of weekDays) {
        if (isSpecialDay(dh.dateKey, holidays)) continue;
        const key = `${employeeId}|${dh.dateKey}`;
        const before = Math.max(0, pool - WEEKLY_PAID_HOURS);
        pool += Math.max(0, dh.workedHours - nightHoursOf(clockByDay.get(key), dh.dateKey, settings));
        const overtime = Math.max(0, pool - WEEKLY_PAID_HOURS) - before;
        if (overtime > 0) result.set(key, overtime);
      }
    }
  }
  return result;
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
        const special = isSpecialDay(dh.dateKey, holidays);
        const inPeriod = dh.dateKey >= from && dh.dateKey <= to;

        if (special) {
          if (inPeriod && dh.workedHours > 0) {
            lines.push({ employeeId, dateKey: dh.dateKey, hours: dh.workedHours, category: 'HS10' });
          }
          continue;
        }

        const night = nightHoursOf(clockByDay.get(`${employeeId}|${dh.dateKey}`), dh.dateKey, settings);
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
  if (!settings.monthlyNiCapCompanyWide) {
    applyMonthlyNiCap(lines, settings.monthlyNiCapHours, false, undefined, input.niAlreadyUsed);
  }
  return lines;
}

// Plus longue duree travaillee sans interruption. Une saisie est continue telle
// que declaree (une reprise apres une pause est une autre saisie). La pointeuse
// ne donne que le premier et le dernier pointage : la pause de l'horaire est
// consideree prise quand sa plage la couvre entierement. Un employe en service
// continu doit donc avoir un horaire sans pause.
export function longestContinuousHours(record: ClockRecord, breakWindow?: { start: string; end: string } | null): number {
  const sourced = record.punch !== undefined || record.declaredIntervals !== undefined;
  let punched = sourced ? (record.punch ? [record.punch] : []) : intervalsOf(record);
  if (breakWindow) {
    const start = new Date(`${record.dateKey}T${breakWindow.start}:00`);
    const end = new Date(`${record.dateKey}T${breakWindow.end}:00`);
    punched = punched.flatMap((i) =>
      i.start <= start && i.end >= end ? [{ start: i.start, end: start }, { start: end, end: i.end }] : [i],
    );
  }
  // Reunies apres coup : une saisie peut couvrir la pause et retablir la continuite.
  return mergeIntervals([...punched, ...(record.declaredIntervals ?? [])]).reduce((max, i) => Math.max(max, hoursBetween(i)), 0);
}

// Paniers : un par employe et par jour, auto-calcule sur la duree travaillee (ou
// sur la duree continue si `continuousHours` est fourni), plus les saisies
// manuelles validees (jamais deux lignes le meme jour).
export function computePanierDays(
  days: DayHours[],
  manualDays: PanierLine[],
  panierMinHours: number,
  from: string,
  to: string,
  continuousHours?: (day: DayHours) => number,
): PanierLine[] {
  const result = new Map<string, PanierLine>();
  for (const dh of days) {
    if (dh.dateKey < from || dh.dateKey > to) continue;
    // Une milliseconde de marge : 8 h pile ne doit pas dependre des flottants.
    if ((continuousHours ? continuousHours(dh) : dh.workedHours) >= panierMinHours - 1e-6) {
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

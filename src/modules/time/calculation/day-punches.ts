// Pointages d'un jour tels qu'ils sont corriges ou figes par la validation :
// des paires entree / sortie "HH:mm" avec leur origine. Les donnees d'origine
// (pointeuse, saisies) ne sont jamais modifiees. Fonctions pures.
import { mergeIntervals, type ClockRecord, type Interval } from './overtime-engine';

export type PunchSource = 'Morpho' | 'Manual' | 'Import' | 'Corrected';

export interface DayPunch {
  // null : borne manquante (pointage a completer).
  start: string | null;
  end: string | null;
  // La sortie a lieu le lendemain.
  nextDay: boolean;
  source: PunchSource;
  // false : travail hors du site (aucun trajet retire). Absent : voir isOnSite.
  onSite?: boolean;
}

// La pointeuse et les corrections sont de la presence sur site, sauf mention contraire.
export const isOnSite = (p: DayPunch) => p.onSite ?? (p.source === 'Morpho' || p.source === 'Corrected');

export const clockOf = (value: Date): string =>
  `${String(value.getHours()).padStart(2, '0')}:${String(value.getMinutes()).padStart(2, '0')}`;

const localKey = (value: Date): string =>
  `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;

export function punchFromDates(
  start: Date | null,
  end: Date | null,
  dateKey: string,
  source: PunchSource,
  // Seulement pour une saisie : "travail sur site" ou non.
  onSite?: boolean,
): DayPunch {
  return {
    start: start ? clockOf(start) : null,
    end: end ? clockOf(end) : null,
    nextDay: !!end && localKey(end) > dateKey,
    source,
    ...(onSite === undefined ? {} : { onSite }),
  };
}

export const sortPunches = (punches: DayPunch[]): DayPunch[] =>
  [...punches].sort((a, b) => (a.start ?? a.end ?? '').localeCompare(b.start ?? b.end ?? ''));

export const isIncompletePunch = (p: DayPunch) => !p.start || !p.end;

export const samePunch = (a: DayPunch, b: DayPunch) => a.start === b.start && a.end === b.end && a.nextDay === b.nextDay;

// Plage horaire d'une paire complete ; null si une borne manque.
export function intervalOf(punch: DayPunch, dateKey: string): Interval | null {
  if (!punch.start || !punch.end) return null;
  const start = new Date(`${dateKey}T${punch.start}:00`);
  const end = new Date(`${dateKey}T${punch.end}:00`);
  if (punch.nextDay) end.setDate(end.getDate() + 1);
  return end > start ? { start, end } : null;
}

// Temps travaille d'un jour corrige ou fige. Une paire encore d'origine
// "pointeuse" reste soumise a la pause de l'horaire (panier) ; une paire saisie
// ou corrigee est continue telle qu'elle est ecrite.
export function recordFromPunches(employeeId: string, dateKey: string, punches: DayPunch[], extraHours: number): ClockRecord {
  let punch: Interval | undefined;
  const declaredIntervals: Interval[] = [];
  for (const p of punches) {
    const interval = intervalOf(p, dateKey);
    if (!interval) continue;
    if (!isOnSite(p)) declaredIntervals.push({ ...interval, remote: true });
    else if (p.source === 'Morpho' && !punch) punch = interval;
    else declaredIntervals.push(interval);
  }
  const intervals = mergeIntervals([...(punch ? [punch] : []), ...declaredIntervals]);
  const midnight = new Date(`${dateKey}T00:00:00`);
  return {
    employeeId,
    dateKey,
    firstClock: intervals[0]?.start ?? midnight,
    lastClock: intervals[intervals.length - 1]?.end ?? midnight,
    intervals,
    extraHours,
    // Un jour revu par un responsable compte meme hors des jours prevus.
    declared: true,
    punch,
    declaredIntervals,
  };
}

// Jour fige par la validation d'une semaine.
export interface FrozenDay {
  date: string;
  punches: DayPunch[];
  extraHours: number;
  panier: boolean;
  permanence: boolean;
  // Minutes de trajet du site au moment de la validation.
  travelMinutes?: number;
  // Pause retiree au moment de la validation ; absente ou null : aucune.
  pause?: { start: string; end: string; nextDay?: boolean } | null;
}

export function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

// Temps travaille d'un employe sur un jour : pointages de la pointeuse et saisies
// de travail approuvees (mission, reunion, travail sur site ou hors site) reunis
// en une seule liste de plages. Source unique du calcul T4, du calcul T5 et de la
// feuille de temps. Fonctions pures.
import { mergeIntervals, type ClockRecord, type Interval } from './overtime-engine';

// Saisies qui sont du temps travaille. Panier et permanence comptent pour une
// prime (1 par jour), jamais pour des heures.
export const WORK_ENTRY_TYPES = ['mission', 'reunion_exterieure', 'travail_hors_site', 'travail_sur_site'];

export interface PunchRow {
  employeeId: string;
  dateKey: string;
  firstClock: Date;
  lastClock: Date;
}

export interface DeclaredRow {
  employeeId: string;
  dateKey: string;
  start: Date | null;
  end: Date | null;
  // Duree declaree, utilisee quand la saisie n'a pas d'horaires.
  hours: number;
}

export function buildWorkRecords(punches: PunchRow[], declared: DeclaredRow[]): Map<string, ClockRecord> {
  // Plusieurs lignes de pointeuse le meme jour (fichiers qui se recouvrent) : le
  // premier pointage le plus tot et le dernier le plus tard.
  const spans = new Map<string, PunchRow>();
  for (const p of punches) {
    const key = `${p.employeeId}|${p.dateKey}`;
    const span = spans.get(key);
    if (!span) spans.set(key, { ...p });
    else {
      if (p.firstClock < span.firstClock) span.firstClock = p.firstClock;
      if (p.lastClock > span.lastClock) span.lastClock = p.lastClock;
    }
  }

  interface Day {
    employeeId: string;
    dateKey: string;
    punch?: Interval;
    declaredIntervals: Interval[];
    extraHours: number;
    declared: boolean;
  }
  const days = new Map<string, Day>();
  const dayOf = (employeeId: string, dateKey: string) => {
    const key = `${employeeId}|${dateKey}`;
    let day = days.get(key);
    if (!day) days.set(key, (day = { employeeId, dateKey, declaredIntervals: [], extraHours: 0, declared: false }));
    return day;
  };
  for (const span of spans.values()) dayOf(span.employeeId, span.dateKey).punch = { start: span.firstClock, end: span.lastClock };
  for (const d of declared) {
    const day = dayOf(d.employeeId, d.dateKey);
    day.declared = true;
    if (d.start && d.end) day.declaredIntervals.push({ start: d.start, end: d.end });
    else day.extraHours += d.hours;
  }

  const result = new Map<string, ClockRecord>();
  for (const [key, day] of days) {
    const intervals = mergeIntervals([...(day.punch ? [day.punch] : []), ...day.declaredIntervals]);
    const midnight = new Date(`${day.dateKey}T00:00:00`);
    result.set(key, {
      employeeId: day.employeeId,
      dateKey: day.dateKey,
      firstClock: intervals[0]?.start ?? midnight,
      lastClock: intervals[intervals.length - 1]?.end ?? midnight,
      intervals,
      extraHours: day.extraHours,
      declared: day.declared,
      punch: day.punch,
      declaredIntervals: day.declaredIntervals,
    });
  }
  return result;
}

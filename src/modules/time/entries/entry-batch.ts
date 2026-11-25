import { isEntryWindowOpen } from './entry-window';

// Saisie en lot : un meme element variable (permanence, panier, hors site,
// mission...) pour plusieurs employes sur une periode. Ce fichier decide, sans
// acces a la base, quelles journees creer et lesquelles ecarter (avec le motif).
// Dates en cles 'YYYY-MM-DD'.

export const BATCH_MAX_DAYS = 62;
export const BATCH_MAX_ENTRIES = 1000;

export const BATCH_SKIP_LABELS = {
  inactive: 'Employé désactivé',
  noRoute: 'Aucun circuit de validation',
  window: 'Hors de la période de saisie',
  beforeHire: "Avant la date d'embauche",
  afterTermination: 'Après la date de départ',
  holiday: 'Jour férié',
  leave: 'En congé approuvé',
  duplicate: 'Déjà déclaré ce jour',
} as const;
export type BatchSkipReason = keyof typeof BATCH_SKIP_LABELS;

export interface BatchEmployee {
  id: string;
  isInactive: boolean;
  hireDate: string | null;
  terminationDate: string | null;
  // Validateur direct, ou pool de validation des temps applicable.
  hasRoute: boolean;
}

export interface BatchLeave {
  employeeId: string;
  start: string;
  end: string;
  startPeriod: string;
  endPeriod: string;
}

export interface BatchPlan {
  toCreate: { employeeId: string; dateKey: string }[];
  skipped: { employeeId: string; dateKey: string; reason: BatchSkipReason }[];
}

export function datesInRange(from: string, to: string): string[] {
  const out: string[] = [];
  const end = new Date(`${to}T00:00:00Z`).getTime();
  for (let t = new Date(`${from}T00:00:00Z`).getTime(); t <= end; t += 86_400_000) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

// 0 = dimanche, comme Date.getUTCDay().
export const weekdayOf = (dateKey: string) => new Date(`${dateKey}T00:00:00Z`).getUTCDay();

// Seule une journee entiere de conge ecarte la saisie : sur une demi-journee,
// l'employe peut avoir travaille l'autre moitie.
export function isFullLeaveDay(leave: BatchLeave, dateKey: string): boolean {
  if (dateKey < leave.start || dateKey > leave.end) return false;
  if (dateKey === leave.start && leave.startPeriod !== 'full') return false;
  if (dateKey === leave.end && leave.endPeriod !== 'full') return false;
  return true;
}

export const declaredKey = (employeeId: string, dateKey: string) => `${employeeId}|${dateKey}`;

export function planBatch(input: {
  employees: BatchEmployee[];
  from: string;
  to: string;
  weekdays: number[];
  includeHolidays: boolean;
  holidays: Map<string, Set<string>>;
  leaves: BatchLeave[];
  // Journees portant deja une saisie du meme type, en attente ou approuvee.
  declared: Set<string>;
  today: string;
}): BatchPlan {
  const plan: BatchPlan = { toCreate: [], skipped: [] };
  const dates = datesInRange(input.from, input.to).filter((d) => input.weekdays.includes(weekdayOf(d)));

  for (const employee of input.employees) {
    const leaves = input.leaves.filter((l) => l.employeeId === employee.id);
    const reasonFor = (dateKey: string): BatchSkipReason | null => {
      if (employee.isInactive) return 'inactive';
      if (!employee.hasRoute) return 'noRoute';
      // La saisie en lot est reservee au RH : sa fenetre de saisie s'applique.
      if (!isEntryWindowOpen(dateKey, input.today, true)) return 'window';
      if (employee.hireDate && dateKey < employee.hireDate) return 'beforeHire';
      if (employee.terminationDate && dateKey > employee.terminationDate) return 'afterTermination';
      if (!input.includeHolidays && input.holidays.get(employee.id)?.has(dateKey)) return 'holiday';
      if (leaves.some((l) => isFullLeaveDay(l, dateKey))) return 'leave';
      if (input.declared.has(declaredKey(employee.id, dateKey))) return 'duplicate';
      return null;
    };
    for (const dateKey of dates) {
      const reason = reasonFor(dateKey);
      if (reason) plan.skipped.push({ employeeId: employee.id, dateKey, reason });
      else plan.toCreate.push({ employeeId: employee.id, dateKey });
    }
  }
  return plan;
}

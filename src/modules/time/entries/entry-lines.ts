// Saisies ligne par ligne (saisie en lot ajustee ou fichier importe) : ce fichier
// decide, sans acces a la base, quelles lignes creer, ignorer, ou soumettre a un
// choix parce qu'elles chevauchent une saisie existante. Rien n'est jamais ecrase
// sans choix explicite. Dates en cles 'YYYY-MM-DD'.
import { WORK_ENTRY_TYPES } from '../calculation/work-records';
import { isEntryWindowOpen } from './entry-window';

export const LINES_MAX = 1000;

export const isOncePerDay = (entryType: string) => entryType === 'panier' || entryType === 'permanence';
export const isWorkType = (entryType: string) => WORK_ENTRY_TYPES.includes(entryType);
// Une saisie de travail avec l'entree OU la sortie seulement : a completer.
export const isIncomplete = (entryType: string, start: unknown, end: unknown) => isWorkType(entryType) && !!start !== !!end;

// Horaires d'une saisie, en minutes depuis le debut de son jour : la sortie d'un
// poste de nuit depasse 24 h.
export interface Slot {
  entryType: string;
  start: number | null;
  end: number | null;
  hours: number;
}

export const minutesOf = (value: Date | null): number | null => (value ? value.getHours() * 60 + value.getMinutes() : null);
export function exitMinutes(start: Date | null, end: Date | null): number | null {
  const minutes = minutesOf(end);
  if (minutes === null || !start || !end) return minutes;
  return end.getDate() === start.getDate() ? minutes : minutes + 24 * 60;
}
const label = (minutes: number | null) =>
  minutes === null ? '?' : `${String(Math.floor(minutes / 60) % 24).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
const frDay = (dateKey: string) => `${dateKey.slice(8, 10)}/${dateKey.slice(5, 7)}`;
const dayAfter = (dateKey: string) => new Date(new Date(`${dateKey}T00:00:00Z`).getTime() + 86_400_000).toISOString().slice(0, 10);
export const slotLabel = (s: Slot) =>
  s.start === null && s.end === null ? `${String(s.hours).replace('.', ',')} h` : `${label(s.start)}-${label(s.end)}`;

export const isSameSlot = (a: Slot, b: Slot) =>
  a.entryType === b.entryType && a.start === b.start && a.end === b.end && (a.start !== null || a.end !== null || a.hours === b.hours);

// Deux saisies de travail du meme jour se chevauchent-elles ? Une duree sans
// horaires chevauche tout (on ne sait pas quand elle a eu lieu). Deux periodes
// qui se suivent (12:00 fin, 12:00 debut) ne se chevauchent pas.
export function overlaps(a: Slot, b: Slot): boolean {
  const unknown = (s: Slot) => s.start === null && s.end === null;
  if (unknown(a) || unknown(b)) return true;
  const full = (s: Slot) => s.start !== null && s.end !== null;
  if (full(a) && full(b)) return a.start! < b.end! && b.start! < a.end!;
  if (full(a) || full(b)) {
    const [period, single] = full(a) ? [a, b] : [b, a];
    const point = (single.start ?? single.end)!;
    return point >= period.start! && point <= period.end!;
  }
  // Deux saisies incompletes : une entree et une sortie se completent (a reunir
  // dans une seule saisie) ; deux entrees differentes sont deux periodes.
  if ((a.start !== null) !== (b.start !== null)) return true;
  return a.start === b.start && a.end === b.end;
}

// Chevauchement de deux saisies qui peuvent etre de jours differents : seul un
// poste qui passe minuit peut toucher celles du lendemain.
export function overlapsAcross(a: Slot, aDate: string, b: Slot, bDate: string): boolean {
  if (aDate === bDate) return overlaps(a, b);
  const [first, firstDate, second, secondDate] = aDate < bDate ? [a, aDate, b, bDate] : [b, bDate, a, aDate];
  if (secondDate !== dayAfter(firstDate) || first.start === null || first.end === null || first.end <= 24 * 60) return false;
  if (second.start === null && second.end === null) return false;
  const later = (minutes: number | null) => (minutes === null ? null : minutes + 24 * 60);
  return overlaps(first, { ...second, start: later(second.start), end: later(second.end) });
}

export interface LineEmployee {
  id: string;
  name: string;
  number: string;
  isInactive: boolean;
  hireDate: string | null;
  terminationDate: string | null;
  hasRoute: boolean;
}

export interface ExistingEntry extends Slot {
  id: string;
  employeeId: string;
  dateKey: string;
  status: 'Pending' | 'Approved';
}

export interface PlannedLine {
  // Employe retrouve par identifiant ou matricule ; null : inconnu.
  employee: LineEmployee | null;
  dateKey: string;
  // null : horaires ou duree invalides, voir `invalid`.
  slot: Slot | null;
  invalid?: string;
  onConflict?: 'skip' | 'replace';
}

export type LineAction = 'create' | 'replace' | 'skip' | 'conflict' | 'error';

export interface LineResult {
  index: number;
  action: LineAction;
  message?: string;
  warnings: string[];
  replaceIds: string[];
  // Un conflit avec une saisie deja approuvee ne peut pas etre remplace.
  canReplace: boolean;
}

export function planLines(input: {
  lines: PlannedLine[];
  // Perimetre de la personne qui saisit ; null : tout le monde (RH).
  scope: Set<string> | null;
  actorId: string;
  existing: ExistingEntry[];
  punches: { employeeId: string; dateKey: string; start: number; end: number }[];
  leaveDays: Set<string>;
  // `employe|jour` d'une semaine validee.
  lockedDays?: Set<string>;
  today: string;
}): LineResult[] {
  const accepted: { index: number; employeeId: string; dateKey: string; slot: Slot }[] = [];
  const replaced = new Set<string>();

  return input.lines.map((line, index) => {
    const result = (action: LineAction, message?: string, extra: Partial<LineResult> = {}): LineResult => ({
      index, action, message, warnings: [], replaceIds: [], canReplace: false, ...extra,
    });
    const { employee, dateKey, slot } = line;
    // Un manager ne doit pas apprendre si un matricule hors de son equipe existe.
    if (input.scope && (!employee || !input.scope.has(employee.id))) return result('error', 'Hors de votre équipe : ligne ignorée');
    if (!employee) return result('error', 'Matricule inconnu');
    if (line.invalid || !slot) return result('error', line.invalid ?? 'Ligne invalide');
    if (employee.isInactive) return result('error', 'Employé désactivé');
    if (!employee.hasRoute) return result('error', 'Aucun circuit de validation');
    // Delai du RH pour qui saisit pour un autre, delai de l'employe pour soi-meme.
    const extended = !input.scope || employee.id !== input.actorId;
    if (!isEntryWindowOpen(dateKey, input.today, extended)) return result('error', 'Hors de la période de saisie');
    if (employee.hireDate && dateKey < employee.hireDate) return result('error', "Avant la date d'embauche");
    if (employee.terminationDate && dateKey > employee.terminationDate) return result('error', 'Après la date de départ');

    const key = `${employee.id}|${dateKey}`;
    if (input.lockedDays?.has(key)) return result('error', 'Semaine validée : plus de modification');
    const once = isOncePerDay(slot.entryType);
    const sameFamily = (other: Slot) => (once ? other.entryType === slot.entryType : isWorkType(other.entryType));

    // Un panier ou une permanence se compare au meme jour ; une periode aussi a la
    // nuit de la veille et au lendemain d'une nuit.
    const touches = (other: Slot, otherDate: string) =>
      once ? otherDate === dateKey : overlapsAcross(slot, dateKey, other, otherDate);
    const previous = accepted.find((a) => a.employeeId === employee.id && sameFamily(a.slot) && touches(a.slot, a.dateKey));
    if (previous) {
      return once || (previous.dateKey === dateKey && isSameSlot(previous.slot, slot))
        ? result('skip', `Même saisie qu'à la ligne ${previous.index + 1}`)
        : result('error', `Chevauche la ligne ${previous.index + 1} du même envoi`);
    }

    const warnings: string[] = [];
    if (input.leaveDays.has(key)) warnings.push('Employé en congé approuvé ce jour');
    if (slot.end !== null && slot.end > 24 * 60) warnings.push(`Sortie le lendemain (${String(slot.hours).replace('.', ',')} h)`);
    const punch = isWorkType(slot.entryType)
      ? input.punches.find(
          (p) => p.employeeId === employee.id && overlapsAcross(slot, dateKey, { ...slot, start: p.start, end: p.end }, p.dateKey),
        )
      : undefined;
    if (punch) {
      warnings.push(`Chevauche la pointeuse (${label(punch.start)}-${label(punch.end)}) : les heures communes ne comptent qu'une fois`);
    }
    const accept = (action: 'create' | 'replace', replaceIds: string[] = []) => {
      accepted.push({ index, employeeId: employee.id, dateKey, slot });
      replaceIds.forEach((id) => replaced.add(id));
      return result(action, undefined, { warnings, replaceIds });
    };

    const clashes = input.existing.filter(
      (e) => e.employeeId === employee.id && !replaced.has(e.id) && sameFamily(e) && touches(e, e.dateKey),
    );
    if (clashes.length === 0) return accept('create');
    if (once) return result('skip', 'Déjà déclaré ce jour', { warnings });
    if (clashes.some((c) => c.dateKey === dateKey && isSameSlot(c, slot))) return result('skip', 'Déjà saisie', { warnings });

    // Une saisie d'un autre jour ne se remplace pas depuis cette ligne.
    const otherDay = clashes.some((c) => c.dateKey !== dateKey);
    const approved = clashes.some((c) => c.status === 'Approved');
    const canReplace = !approved && !otherDay;
    const described = clashes
      .map((c) => `${slotLabel(c)}${c.dateKey === dateKey ? '' : ` du ${frDay(c.dateKey)}`} (${c.status === 'Approved' ? 'approuvée' : 'en attente'})`)
      .join(', ');
    const why = approved ? '. Une saisie approuvée ne se remplace pas' : otherDay ? ". Une saisie d'un autre jour ne se remplace pas ici" : '';
    if (line.onConflict === 'skip') return result('skip', `Saisie existante gardée : ${described}`, { warnings });
    if (line.onConflict === 'replace' && canReplace) return accept('replace', clashes.map((c) => c.id));
    return result('conflict', `Chevauche : ${described}${why}`, { warnings, canReplace });
  });
}

// Historique des saisies venant de Pointage : la colonne "changes" contient un JSON
// ({ champ: { before, after } } par champ modifie, ou l'etat initial a la creation).
// Le HRM affiche un texte lisible, jamais ce JSON : cette fonction le traduit a la
// migration. Sans dependance (utilisee aussi par prisma/migrate-time-from-pointage.ts).

const ENTRY_TYPES: Record<string, string> = {
  mission: 'Mission',
  reunion_exterieure: 'Réunion extérieure',
  travail_hors_site: 'Travail hors site',
  travail_sur_site: 'Travail sur site',
  permanence: 'Permanence',
  panier: 'Panier',
};
const STATUSES: Record<string, string> = {
  Pending: 'En attente',
  Approved: 'Approuvée',
  Rejected: 'Refusée',
  Cancelled: 'Annulée',
};
const LABELS: Record<string, string> = {
  date: 'Date',
  hours: 'Durée',
  entryType: 'Type',
  comments: 'Commentaire',
  firstClockIn: 'Entrée',
  lastClockOut: 'Sortie',
  status: 'Statut',
  rejectionReason: 'Motif',
};
// Champs jamais affiches (identifiants internes).
const HIDDEN = new Set(['validatedById']);

type Change = { before?: unknown; after?: unknown };

const isEmpty = (v: unknown) => v === null || v === undefined || v === '';

function formatValue(field: string, v: unknown): string {
  if (isEmpty(v)) return 'vide';
  const text = String(v);
  switch (field) {
    case 'hours': {
      const n = Number(text.replace(',', '.'));
      return Number.isFinite(n) ? `${String(Math.round(n * 100) / 100).replace('.', ',')} h` : text;
    }
    case 'date': {
      const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
      return m ? `${m[3]}/${m[2]}/${m[1]}` : text;
    }
    case 'firstClockIn':
    case 'lastClockOut': {
      const m = /T(\d{2}:\d{2})/.exec(text) ?? /^(\d{2}:\d{2})/.exec(text);
      return m ? m[1]! : text;
    }
    case 'entryType':
      return ENTRY_TYPES[text] ?? text;
    case 'status':
      return STATUSES[text] ?? text;
    default:
      return text;
  }
}

// Accepte { champ: {before, after} } (format Pointage) et { before: {...}, after: {...} }.
function toChanges(parsed: Record<string, unknown>): Record<string, Change> {
  const keys = Object.keys(parsed);
  if (keys.length > 0 && keys.every((k) => k === 'before' || k === 'after')) {
    const before = (parsed.before ?? {}) as Record<string, unknown>;
    const after = (parsed.after ?? {}) as Record<string, unknown>;
    const out: Record<string, Change> = {};
    for (const f of new Set([...Object.keys(before), ...Object.keys(after)])) out[f] = { before: before[f], after: after[f] };
    return out;
  }
  const out: Record<string, Change> = {};
  for (const [f, v] of Object.entries(parsed)) {
    if (v && typeof v === 'object' && ('before' in v || 'after' in v)) out[f] = v as Change;
  }
  return out;
}

// Texte lisible d'une ligne d'historique, ou null s'il n'y a rien d'utile a dire (le
// libelle de l'action suffit : "Approuvée", "Saisie créée"...). Un texte qui n'est pas du JSON est garde tel quel.
export function describeLegacyChanges(action: string, raw: string | null | undefined): string | null {
  const text = (raw ?? '').trim();
  if (!text) return null;
  if (!text.startsWith('{')) return text.slice(0, 500);
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
  const changes = toChanges(parsed);
  const fields = Object.keys(changes).filter((f) => !HIDDEN.has(f));

  if (action === 'CREATE') {
    const get = (f: string) => changes[f]?.after;
    const parts = [
      !isEmpty(get('entryType')) ? formatValue('entryType', get('entryType')) : null,
      !isEmpty(get('date')) ? formatValue('date', get('date')) : null,
      !isEmpty(get('hours')) ? formatValue('hours', get('hours')) : null,
    ].filter(Boolean);
    return parts.length ? parts.join(', ') : null;
  }

  if (action === 'APPROVE' || action === 'REJECT') {
    const reason = changes.rejectionReason?.after;
    return action === 'REJECT' && !isEmpty(reason) ? `Motif : ${String(reason)}` : null;
  }

  const lines = fields
    .filter((f) => f !== 'status')
    .map((f) => {
      const c = changes[f]!;
      const label = LABELS[f] ?? f;
      return `${label} ${formatValue(f, c.before)} → ${formatValue(f, c.after)}`;
    });
  return lines.length ? lines.join(' ; ') : null;
}

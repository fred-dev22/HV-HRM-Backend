// Constantes et petits utilitaires du module Formation.

// Codes de reference courts (FOR001, SES001), meme convention que le module
// Recrutement (voir recruitment.util.ts nextReferenceCode).
export const TRAINING_REFERENCE_PREFIXES = {
  course: 'FOR',
  session: 'SES',
} as const;

// Une inscription occupe une place dans la session tant qu'elle n'est ni
// refusee ni annulee. L'effectif d'une session se deduit de ces statuts, il
// n'est jamais stocke.
export const SEAT_HOLDING_STATUSES = ['Requested', 'Approved', 'Attended'];

// L'evaluation a froid est due 3 mois apres l'evaluation a chaud.
export const COLD_EVALUATION_DELAY_MONTHS = 3;

export const COURSE_STATUSES = ['InPreparation', 'InProgress', 'Archived'] as const;
export const SESSION_MODES = ['InPerson', 'VideoCall'] as const;
export const PROVIDER_STATUSES = ['active', 'inactive'] as const;

// 'YYYY-MM-DD' pour une colonne @db.Date (ou undefined si vide).
export function toDay(value: Date | null | undefined): string | undefined {
  return value ? value.toISOString().slice(0, 10) : undefined;
}

export function toNumber(value: unknown): number | undefined {
  return value === null || value === undefined ? undefined : Number(value);
}

// Aujourd'hui a minuit UTC, pour les colonnes @db.Date.
export function todayUtc(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

// Prochain 1er decembre strictement apres `from` : l'evaluation annuelle des
// prestataires est relancee chaque debut decembre.
export function nextDecemberFirst(from: Date = new Date()): Date {
  const thisYear = new Date(Date.UTC(from.getUTCFullYear(), 11, 1));
  return thisYear > from ? thisYear : new Date(Date.UTC(from.getUTCFullYear() + 1, 11, 1));
}

export function addMonthsUtc(date: Date, months: number): Date {
  const result = new Date(date);
  result.setUTCMonth(result.getUTCMonth() + months);
  return result;
}

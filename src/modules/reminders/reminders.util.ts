import { ForbiddenException } from '@nestjs/common';
import { createHash } from 'crypto';

// Paliers d'alerte (en jours) du cron quotidien. Data-driven : modifier ce
// tableau suffit a changer le rythme des rappels.
export const LEAD_BUCKETS = [30, 14, 7, 1] as const;

export type ReminderCategory =
  | 'cdd_end'
  | 'internship_end'
  | 'birthday'
  | 'trial_end'
  | 'contract_end';

export type ReminderEntityType = 'Employee' | 'TrialEmployee' | 'RecruitmentContract';

// Ordre d'affichage stable quand deux echeances tombent le meme jour.
export const CATEGORY_ORDER: Record<ReminderCategory, number> = {
  cdd_end: 0,
  internship_end: 1,
  birthday: 2,
  trial_end: 3,
  contract_end: 4,
};

export interface ReminderItem {
  category: ReminderCategory;
  entityType: ReminderEntityType;
  entityId: string;
  // YYYY-MM-DD : date d'echeance, ou prochaine occurrence pour un anniversaire.
  date: string;
  // Par rapport a aujourd'hui (date serveur). Peut etre negatif si l'appelant
  // fournit un `From` dans le passe.
  daysUntil: number;
  // "Jean Dupont - fin de CDD"
  label: string;
  // "Jean Dupont"
  subjectName: string;
  // Employee.Id pour cdd_end | internship_end | birthday uniquement.
  employeeId?: string;
  // Nom de l'entite (unite organisationnelle ou texte libre du contrat/essai).
  entityName?: string;
  href: string;
}

// -------------------------------------------------------------------------
// Dates
// -------------------------------------------------------------------------

// Minuit UTC du jour porte par `input` (chaine 'YYYY-MM-DD' ou Date).
export function startOfDayUtc(input: string | Date): Date {
  const d = typeof input === 'string' ? new Date(input) : input;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

// Aujourd'hui : composantes calendaires locales du serveur, figees a minuit
// UTC pour que toutes les comparaisons se fassent sur la meme reference. La
// zone de deploiement (Africa/Antananarivo, UTC+3, sans changement d'heure)
// rend le risque de decalage d'un jour negligeable.
export function todayDateOnly(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
}

export function addDays(base: Date, days: number): Date {
  return new Date(base.getTime() + days * 86_400_000);
}

export function daysBetween(from: Date, to: Date): number {
  return Math.round(
    (startOfDayUtc(to).getTime() - startOfDayUtc(from).getTime()) / 86_400_000,
  );
}

export function daysUntil(due: Date | string, ref: Date): number {
  return Math.floor(
    (startOfDayUtc(due).getTime() - startOfDayUtc(ref).getTime()) / 86_400_000,
  );
}

export function toYmd(d: Date): string {
  return startOfDayUtc(d).toISOString().slice(0, 10);
}

export function parseYmd(s: string): Date {
  return startOfDayUtc(s);
}

// Construit une date UTC en ramenant un jour invalide (29/02 en annee non
// bissextile) au dernier jour du mois voulu (=> 28/02, convention type paie).
function makeUtcDate(year: number, month: number, day: number): Date {
  const d = new Date(Date.UTC(year, month, day));
  if (d.getUTCMonth() !== month) {
    return new Date(Date.UTC(year, month + 1, 0));
  }
  return d;
}

// Prochaine occurrence de l'anniversaire (mois/jour de `birthDate`) a partir
// de `from` inclus. Gere le passage d'annee (fenetre a cheval sur deux annees).
export function nextBirthdayOccurrence(birthDate: Date | string, from: Date): Date {
  const b = typeof birthDate === 'string' ? new Date(birthDate) : birthDate;
  const month = b.getUTCMonth();
  const day = b.getUTCDate();
  const fromMidnight = startOfDayUtc(from);
  let occ = makeUtcDate(fromMidnight.getUTCFullYear(), month, day);
  if (occ.getTime() < fromMidnight.getTime()) {
    occ = makeUtcDate(fromMidnight.getUTCFullYear() + 1, month, day);
  }
  return occ;
}

// True si le mois/jour de `date` tombe dans [from, to] bornes incluses,
// passage d'annee gere via nextBirthdayOccurrence.
export function isInWindowMonthDay(date: Date | string, from: Date, to: Date): boolean {
  const occ = nextBirthdayOccurrence(date, from);
  return (
    occ.getTime() >= startOfDayUtc(from).getTime() &&
    occ.getTime() <= startOfDayUtc(to).getTime()
  );
}

// -------------------------------------------------------------------------
// Paliers d'alerte
// -------------------------------------------------------------------------

// Plus petit palier >= `days` ; <= 1 (aujourd'hui / en retard) -> 1 ; au-dela
// de 30 jours -> null (pas encore de rappel a envoyer).
export function leadBucketFor(days: number): number | null {
  if (days > 30) return null;
  for (const b of [1, 7, 14, 30]) {
    if (days <= b) return b;
  }
  return null;
}

// -------------------------------------------------------------------------
// Cle anti-doublon (sha256, tronquee a 64 hex = colonne NVarChar(64))
// -------------------------------------------------------------------------

export function buildDedupKey(
  category: string,
  entityType: string,
  entityId: string,
  dueDateIso: string,
  leadBucket: number,
  recipientId: string,
): string {
  return createHash('sha256')
    .update([category, entityType, entityId, dueDateIso, leadBucket, recipientId].join('|'))
    .digest('hex')
    .slice(0, 64);
}

// -------------------------------------------------------------------------
// Permissions
// -------------------------------------------------------------------------

export function assertCanViewDeadlines(permissions: Set<string>): void {
  if (permissions.has('EMPLOYE_VOIR_TOUT') || permissions.has('EMPLOYE_VOIR_EQUIPE')) return;
  throw new ForbiddenException(
    "Vous n'avez pas la permission de consulter les echeances a venir",
  );
}

// -------------------------------------------------------------------------
// Libelles FR (aucun tiret cadratin dans les chaines visibles)
// -------------------------------------------------------------------------

const CATEGORY_SUFFIX: Record<ReminderCategory, string> = {
  cdd_end: 'fin de CDD',
  internship_end: 'fin de stage',
  birthday: 'anniversaire',
  trial_end: 'fin de periode d essai',
  contract_end: 'fin de contrat',
};

export function reminderLabel(category: ReminderCategory, subjectName: string): string {
  return `${subjectName} - ${CATEGORY_SUFFIX[category]}`;
}

function frDate(ymd: string): string {
  const [y, m, d] = ymd.split('-');
  return `${d}/${m}/${y}`;
}

function whenText(days: number): string {
  if (days <= 0) return "aujourd'hui";
  if (days === 1) return 'dans 1 jour';
  return `dans ${days} jours`;
}

export function reminderTitle(item: ReminderItem): string {
  return `Rappel : ${CATEGORY_SUFFIX[item.category]} ${whenText(item.daysUntil)}`;
}

export function reminderMessage(item: ReminderItem): string {
  const entity = item.entityName ? ` (${item.entityName})` : '';
  const when = frDate(item.date);
  switch (item.category) {
    case 'cdd_end':
      return `Le CDD de ${item.subjectName}${entity} se termine le ${when}.`;
    case 'internship_end':
      return `Le stage de ${item.subjectName}${entity} se termine le ${when}.`;
    case 'birthday':
      return `${item.subjectName}${entity} fete son anniversaire le ${when}.`;
    case 'trial_end':
      return `La periode d essai de ${item.subjectName}${entity} se termine le ${when}.`;
    case 'contract_end':
      return `Le contrat de ${item.subjectName}${entity} se termine le ${when}.`;
    default:
      return `Echeance pour ${item.subjectName} le ${when}.`;
  }
}

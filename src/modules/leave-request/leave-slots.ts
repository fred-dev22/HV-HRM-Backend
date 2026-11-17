// Demi-journees occupees par une demande de conge, pour detecter les
// chevauchements au plus juste : deux demandes qui se touchent le meme jour
// mais sur des moities differentes (ex. un conge qui finit vendredi matin et
// une recuperation vendredi apres-midi) ne se chevauchent pas.
//
// Convention (identique au decompte des jours, voir computeWorkingDays et le
// frontend utils/calendar.ts) :
//   - debut : 'pm' = a partir de l'apres-midi ; 'am' ou 'full' = depuis le matin
//             (au debut, "Matin" compte la journee entiere) ;
//   - fin   : 'am' = jusqu'a la fin de la matinee ; 'pm' ou 'full' = jusqu'au soir.
// Chaque jour porte deux creneaux : matin = 2 * jour, apres-midi = 2 * jour + 1.

const DAY_MS = 86_400_000;

function dayNumber(date: Date): number {
  // Colonnes @db.Date : minuit UTC. On raisonne en jours entiers.
  return Math.floor(date.getTime() / DAY_MS);
}

export interface LeaveSlotRange {
  first: number;
  last: number;
}

export function leaveSlotRange(
  startDate: Date,
  startPeriod: string | null | undefined,
  endDate: Date,
  endPeriod: string | null | undefined,
): LeaveSlotRange {
  const first = dayNumber(startDate) * 2 + (startPeriod === 'pm' ? 1 : 0);
  const rawLast = dayNumber(endDate) * 2 + (endPeriod === 'am' ? 0 : 1);
  // Une demande incoherente (fin avant debut) occupe au moins son premier creneau.
  return { first, last: Math.max(first, rawLast) };
}

export function leaveSlotsOverlap(a: LeaveSlotRange, b: LeaveSlotRange): boolean {
  return a.first <= b.last && a.last >= b.first;
}

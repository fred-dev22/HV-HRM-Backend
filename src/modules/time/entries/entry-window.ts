// Fenetres de saisie des temps (regle du systeme Pointage) : pour une saisie
// datee dans le mois M,
//  - l'employe peut saisir ou modifier jusqu'au 1er du mois M+1 exclu, donc
//    jusqu'au dernier jour de M ;
//  - le RH peut le faire jusqu'au 15 du mois M+1 inclus.
// Dates en cles 'YYYY-MM-DD'.

export const EMPLOYEE_ENTRY_DEADLINE_DAY = 1; // exclu, du mois suivant
export const HR_ENTRY_DEADLINE_DAY = 15; // inclus, du mois suivant

function nextMonthPrefix(dateKey: string): string {
  const year = Number(dateKey.slice(0, 4));
  const month = Number(dateKey.slice(5, 7));
  return month === 12 ? `${year + 1}-01` : `${year}-${String(month + 1).padStart(2, '0')}`;
}

// Dernier jour (inclus) ou la saisie est encore permise.
export function entryDeadline(entryDateKey: string, isHr: boolean): string {
  const next = nextMonthPrefix(entryDateKey);
  if (isHr) return `${next}-${String(HR_ENTRY_DEADLINE_DAY).padStart(2, '0')}`;
  // Jusqu'au 1er exclu : le dernier jour du mois de la saisie.
  const year = Number(entryDateKey.slice(0, 4));
  const month = Number(entryDateKey.slice(5, 7));
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${entryDateKey.slice(0, 7)}-${String(lastDay).padStart(2, '0')}`;
}

export function isEntryWindowOpen(entryDateKey: string, todayKey: string, isHr: boolean): boolean {
  return todayKey <= entryDeadline(entryDateKey, isHr);
}

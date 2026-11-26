// Coherence des heures d'un jour de calendrier, en minutes depuis minuit. Une fin
// avant le debut est un poste de nuit : elle tombe le lendemain, et la pause peut
// alors se placer avant ou apres minuit.

// Au-dela, une fin avant le debut est plutot une faute de saisie qu'un poste de nuit.
export const NIGHT_SHIFT_MAX_HOURS = 16;

export function workDayError(
  start: number,
  end: number,
  rest?: { start: number; end: number } | null,
): string | null {
  if (end === start) return "l'heure de fin doit être différente de l'heure de début";
  const overnight = end < start;
  if (overnight && end + 1440 - start > NIGHT_SHIFT_MAX_HOURS * 60) {
    return `un poste de nuit ne dépasse pas ${NIGHT_SHIFT_MAX_HOURS} h : vérifiez les heures de début et de fin`;
  }
  if (!rest) return null;
  // Poste de nuit : une heure anterieure au debut appartient au lendemain.
  const place = (value: number) => (overnight && value < start ? value + 1440 : value);
  const from = place(rest.start);
  const to = place(rest.end);
  const finish = overnight ? end + 1440 : end;
  if (to <= from) return 'la pause doit finir après avoir commencé';
  if (from < start) return "la pause ne peut pas commencer avant l'heure de début";
  if (to > finish) return "la pause ne peut pas finir après l'heure de fin";
  return null;
}

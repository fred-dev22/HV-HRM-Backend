// Dit si la generation mensuelle des acquisitions de conges est "due".
//
// Regle de rattrapage : due des que le jour choisi par l'entreprise est atteint
// OU DEPASSE dans le mois, tant qu'elle n'a pas tourne ce mois-ci. Un jour
// manque (serveur endormi, arret, deploiement a 1 h du matin) est donc rattrape
// au passage suivant au lieu d'etre perdu. Un jour choisi plus grand que la
// longueur du mois (ex : 31 en avril) est ramene au dernier jour du mois.
export function isAccrualDue(runDay: number | null | undefined, lastRunAt: Date | null | undefined, now: Date): boolean {
  if (!runDay || runDay < 1) return false;

  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const effectiveDay = Math.min(runDay, daysInMonth);
  if (now.getDate() < effectiveDay) return false;

  const ranThisMonth =
    !!lastRunAt && lastRunAt.getFullYear() === now.getFullYear() && lastRunAt.getMonth() === now.getMonth();
  return !ranThisMonth;
}

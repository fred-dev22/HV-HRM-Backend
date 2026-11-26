// Postes de nuit et pointeuse. La pointeuse ne donne que le premier et le dernier
// passage de chaque DATE : pour un poste 22:00-06:00, la ligne du lundi porte la
// sortie du dimanche matin et l'entree du lundi soir. Quand l'horaire du jour
// finit le lendemain, le poste est reconstitue avec le soir du jour et le matin
// du lendemain. Les autres jours ne changent pas. Fonctions pures.

export interface DaySpan {
  employeeId: string;
  dateKey: string;
  // Egaux quand un seul passage est connu.
  first: Date;
  last: Date;
  // Poste de nuit dont il manque un passage.
  missing?: 'start' | 'end';
}

// Horaire "HH:mm" du jour quand il finit le lendemain, sinon null.
export type NightScheduleOf = (employeeId: string, dateKey: string) => { start: string; end: string } | null;

const minutes = (value: Date) => value.getHours() * 60 + value.getMinutes();
const clockMinutes = (time: string) => {
  const [h, m] = time.split(':').map(Number);
  return h! * 60 + (m ?? 0);
};
const localKey = (value: Date) =>
  `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
const shift = (dateKey: string, days: number) => {
  const d = new Date(`${dateKey}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

// `spans` : au plus une plage par employe et par date. Le resultat aussi.
export function pairNightShifts(spans: DaySpan[], nightFor: NightScheduleOf): DaySpan[] {
  const byEmployee = new Map<string, Map<string, DaySpan>>();
  for (const span of spans) {
    if (!byEmployee.has(span.employeeId)) byEmployee.set(span.employeeId, new Map());
    byEmployee.get(span.employeeId)!.set(span.dateKey, span);
  }

  const result: DaySpan[] = [];
  for (const [employeeId, days] of byEmployee) {
    // Passages deja rattaches a un poste de nuit.
    const used = new Set<Date>();
    const paired = new Set<string>();
    const punchesOf = (span: DaySpan) => (span.first.getTime() === span.last.getTime() ? [span.first] : [span.first, span.last]);
    // La veille d'un jour pointe compte aussi : seule la sortie du matin a pu etre lue.
    const candidates = [...new Set([...days.keys()].flatMap((d) => [shift(d, -1), d]))].sort();

    for (const dateKey of candidates) {
      const schedule = nightFor(employeeId, dateKey);
      if (!schedule) continue;
      const today = days.get(dateKey);
      // Le fichier donne deja la sortie du lendemain : rien a reconstituer.
      if (today && localKey(today.last) > dateKey) continue;
      // Milieu du repos : avant, un passage est une sortie ; apres, une entree.
      const middle = (clockMinutes(schedule.start) + clockMinutes(schedule.end)) / 2;
      const entry = today ? punchesOf(today).find((p) => !used.has(p) && minutes(p) >= middle) : undefined;
      const next = days.get(shift(dateKey, 1));
      const exits = next ? punchesOf(next).filter((p) => localKey(p) === next.dateKey && minutes(p) < middle) : [];
      const exit = exits[exits.length - 1];
      if (!entry && !exit) continue;
      if (today) punchesOf(today).filter((p) => minutes(p) >= middle).forEach((p) => used.add(p));
      exits.forEach((p) => used.add(p));
      paired.add(dateKey);
      result.push({
        employeeId,
        dateKey,
        first: entry ?? exit!,
        last: exit ?? entry!,
        ...(entry && exit ? {} : { missing: entry ? ('end' as const) : ('start' as const) }),
      });
    }

    // Ce qui n'appartient a aucun poste de nuit reste sur sa date.
    for (const [dateKey, span] of days) {
      if (paired.has(dateKey)) continue;
      const left = punchesOf(span).filter((p) => !used.has(p));
      if (left.length) result.push({ employeeId, dateKey, first: left[0]!, last: left[left.length - 1]! });
    }
  }
  return result;
}

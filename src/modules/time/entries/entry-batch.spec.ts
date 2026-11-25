import { BatchEmployee, datesInRange, isFullLeaveDay, planBatch } from './entry-batch';

const employee = (over: Partial<BatchEmployee> = {}): BatchEmployee => ({
  id: 'a', isInactive: false, hireDate: '2020-01-01', terminationDate: null, hasRoute: true, ...over,
});

const plan = (over: Partial<Parameters<typeof planBatch>[0]> = {}) =>
  planBatch({
    employees: [employee()],
    from: '2026-11-02', // lundi
    to: '2026-11-08', // dimanche
    weekdays: [1, 2, 3, 4, 5],
    includeHolidays: false,
    holidays: new Map(),
    leaves: [],
    declared: new Set(),
    today: '2026-11-25',
    ...over,
  });

const reasons = (p: ReturnType<typeof planBatch>) => p.skipped.map((s) => `${s.employeeId} ${s.dateKey} ${s.reason}`);

describe('saisie en lot : journees retenues', () => {
  it('ne garde que les jours de semaine choisis', () => {
    expect(plan().toCreate.map((c) => c.dateKey)).toEqual(['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06']);
    expect(plan({ weekdays: [6, 0] }).toCreate.map((c) => c.dateKey)).toEqual(['2026-11-07', '2026-11-08']);
  });

  it('cree une ligne par employe et par jour', () => {
    expect(plan({ employees: [employee(), employee({ id: 'b' })] }).toCreate).toHaveLength(10);
  });

  it("ecarte les jours feries de l'employe, sauf demande contraire", () => {
    const holidays = new Map([['a', new Set(['2026-11-03'])]]);
    expect(reasons(plan({ holidays }))).toEqual(['a 2026-11-03 holiday']);
    expect(plan({ holidays, includeHolidays: true }).toCreate).toHaveLength(5);
  });

  it('ecarte un conge entier mais garde une demi-journee', () => {
    const leaves = [{ employeeId: 'a', start: '2026-11-03', end: '2026-11-05', startPeriod: 'pm', endPeriod: 'full' }];
    expect(reasons(plan({ leaves }))).toEqual(['a 2026-11-04 leave', 'a 2026-11-05 leave']);
  });

  it('ecarte les journees deja declarees', () => {
    expect(reasons(plan({ declared: new Set(['a|2026-11-04']) }))).toEqual(['a 2026-11-04 duplicate']);
  });

  it("respecte la date d'embauche et la date de depart", () => {
    const p = plan({ employees: [employee({ hireDate: '2026-11-04', terminationDate: '2026-11-05' })] });
    expect(p.toCreate.map((c) => c.dateKey)).toEqual(['2026-11-04', '2026-11-05']);
    expect(p.skipped.map((s) => s.reason)).toEqual(['beforeHire', 'beforeHire', 'afterTermination']);
  });

  it('applique la fenetre de saisie du RH (jusqu au 15 du mois suivant)', () => {
    const p = plan({ from: '2026-10-30', to: '2026-11-02' });
    expect(reasons(p)).toEqual(['a 2026-10-30 window']);
  });

  it('ecarte un employe desactive ou sans circuit de validation', () => {
    const p = plan({ employees: [employee({ id: 'x', isInactive: true }), employee({ id: 'y', hasRoute: false })] });
    expect(p.toCreate).toEqual([]);
    expect(new Set(p.skipped.map((s) => `${s.employeeId} ${s.reason}`))).toEqual(new Set(['x inactive', 'y noRoute']));
  });
});

describe('outils de dates', () => {
  it('liste les dates bornes comprises, meme au changement de mois', () => {
    expect(datesInRange('2026-10-31', '2026-11-02')).toEqual(['2026-10-31', '2026-11-01', '2026-11-02']);
  });

  it('une absence d une demi-journee ne compte pas comme un jour entier', () => {
    const half = { employeeId: 'a', start: '2026-11-03', end: '2026-11-03', startPeriod: 'am', endPeriod: 'am' };
    expect(isFullLeaveDay(half, '2026-11-03')).toBe(false);
  });
});

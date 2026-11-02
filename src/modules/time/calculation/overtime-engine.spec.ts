import {
  DEFAULT_TIME_SETTINGS,
  buildSageRows,
  computeDailyHours,
  computeOvertimeLines,
  computePanierDays,
  computePermanenceLines,
  mondayOf,
  nightOverlapHours,
  requiredHoursOfSchedule,
  type DayHours,
  type OvertimeLine,
} from './overtime-engine';

// Semaine du lundi 2026-01-05 au dimanche 2026-01-11.
const MON = '2026-01-05';
const TUE = '2026-01-06';
const WED = '2026-01-07';
const THU = '2026-01-08';
const FRI = '2026-01-09';
const SAT = '2026-01-10';
const SUN = '2026-01-11';

const day = (dateKey: string, worked: number, required = 8, employeeId = 'E1'): DayHours => ({
  employeeId,
  dateKey,
  workedHours: worked,
  requiredHours: required,
});

const run = (days: DayHours[], extra: Partial<Parameters<typeof computeOvertimeLines>[0]> = {}) =>
  computeOvertimeLines({
    days,
    clocks: [],
    holidays: new Set(),
    settings: DEFAULT_TIME_SETTINGS,
    method: 'daily',
    from: MON,
    to: SUN,
    ...extra,
  });

const sum = (lines: OvertimeLine[], category: string) =>
  lines.filter((l) => l.category === category).reduce((s, l) => s + l.hours, 0);

describe('dates', () => {
  it('le lundi d un dimanche est le lundi de la meme semaine', () => {
    expect(mondayOf(SUN)).toBe(MON);
    expect(mondayOf(MON)).toBe(MON);
    expect(mondayOf(WED)).toBe(MON);
  });
});

describe('requiredHoursOfSchedule', () => {
  it('retire la pause et arrondit au dixieme', () => {
    expect(
      requiredHoursOfSchedule({ isWorkingDay: true, startTime: '08:00', endTime: '17:00', breakStart: '12:00', breakEnd: '13:00' }),
    ).toBe(8);
    expect(requiredHoursOfSchedule({ isWorkingDay: true, startTime: '07:30', endTime: '16:00' })).toBe(8.5);
  });

  it('renvoie null pour un jour non travaille ou incomplet', () => {
    expect(requiredHoursOfSchedule({ isWorkingDay: false, startTime: '08:00', endTime: '17:00' })).toBeNull();
    expect(requiredHoursOfSchedule({ isWorkingDay: true, startTime: null, endTime: '17:00' })).toBeNull();
  });
});

describe('computeDailyHours', () => {
  const rec = (dateKey: string, from: [number, number], to: [number, number]) => ({
    employeeId: 'E1',
    dateKey,
    firstClock: new Date(2026, 0, Number(dateKey.slice(8)), from[0], from[1]),
    lastClock: new Date(2026, 0, Number(dateKey.slice(8)), to[0], to[1]),
  });

  it('calcule dernier moins premier pointage et la duree prevue', () => {
    const { days, skipped } = computeDailyHours([rec(MON, [8, 0], [17, 30])], new Set(), () => 8);
    expect(skipped).toBe(0);
    expect(days[0]!.workedHours).toBe(9.5);
    expect(days[0]!.requiredHours).toBe(8);
  });

  it('un jour ferie vaut 0 heure prevue', () => {
    const { days } = computeDailyHours([rec(MON, [8, 0], [12, 0])], new Set([MON]), () => 8);
    expect(days[0]!.requiredHours).toBe(0);
  });

  it('ignore un jour sans horaire', () => {
    const { days, skipped } = computeDailyHours([rec(SUN, [8, 0], [12, 0])], new Set(), () => null);
    expect(days).toHaveLength(0);
    expect(skipped).toBe(1);
  });

  it('garde un jour non travaille pointe seulement sur demande', () => {
    const records = [rec(SUN, [9, 0], [14, 0])];
    const kept = computeDailyHours(records, new Set(), () => null, undefined, { includeNonWorkingDays: true });
    expect(kept.days).toHaveLength(1);
    expect(kept.days[0]!.requiredHours).toBe(0);
    expect(kept.days[0]!.workedHours).toBe(5);
  });

  it('ne retire la pause que sur demande', () => {
    const records = [rec(MON, [8, 0], [17, 0])];
    const without = computeDailyHours(records, new Set(), () => 8, () => 1);
    const withBreak = computeDailyHours(records, new Set(), () => 8, () => 1, { deductBreak: true });
    expect(without.days[0]!.workedHours).toBe(9);
    expect(withBreak.days[0]!.workedHours).toBe(8);
  });
});

describe('heures supplementaires, methode journaliere', () => {
  it('repartit 8 h a 130 % puis 150 % sur la semaine (avant plafond NI)', () => {
    const lines = run([day(MON, 10), day(TUE, 14), day(WED, 11)], {
      settings: { ...DEFAULT_TIME_SETTINGS, monthlyNiCapHours: 0 },
    });
    expect(lines.filter((l) => l.category === 'HS01').map((l) => [l.dateKey, l.hours])).toEqual([
      [MON, 2],
      [TUE, 6],
    ]);
    expect(lines.filter((l) => l.category === 'HS02').map((l) => [l.dateKey, l.hours])).toEqual([[WED, 3]]);
  });

  it('convertit en HS03/HS04 tant que le plafond mensuel de 20 h n est pas atteint', () => {
    const lines = run([day(MON, 10), day(TUE, 14), day(WED, 11)]);
    expect(sum(lines, 'HS01')).toBe(0);
    expect(sum(lines, 'HS02')).toBe(0);
    expect(sum(lines, 'HS03')).toBe(8);
    expect(sum(lines, 'HS04')).toBe(3);
  });

  it('scinde une ligne quand le plafond tombe en son milieu', () => {
    const lines = run([day(MON, 10), day(TUE, 14), day(WED, 11)], {
      settings: { ...DEFAULT_TIME_SETTINGS, monthlyNiCapHours: 5 },
    });
    expect(sum(lines, 'HS03')).toBe(5);
    expect(sum(lines, 'HS01')).toBe(3);
    expect(sum(lines, 'HS02')).toBe(3);
    expect(sum(lines, 'HS04')).toBe(0);
  });

  it('un jour sous l horaire ne genere rien', () => {
    expect(run([day(MON, 7), day(TUE, 8)])).toEqual([]);
  });

  it('le cumul hebdomadaire repart a zero la semaine suivante', () => {
    const nextMon = '2026-01-12';
    const lines = run([day(THU, 16), day(nextMon, 10)], {
      settings: { ...DEFAULT_TIME_SETTINGS, monthlyNiCapHours: 0 },
      to: '2026-01-18',
    });
    // Jeudi : 8 h supp -> tout HS01 ; lundi suivant : 2 h supp -> HS01 de nouveau.
    expect(lines.map((l) => [l.dateKey, l.category, l.hours])).toEqual([
      [THU, 'HS01', 8],
      [nextMon, 'HS01', 2],
    ]);
  });

  it('un dimanche donne HS10 sur toutes les heures et sort du pool', () => {
    const lines = run([day(SUN, 5, 0), day(MON, 10)], { settings: { ...DEFAULT_TIME_SETTINGS, monthlyNiCapHours: 0 } });
    expect(sum(lines, 'HS10')).toBe(5);
    expect(sum(lines, 'HS01')).toBe(2);
  });

  it('un jour ferie donne HS10', () => {
    const lines = run([day(WED, 6, 0)], { holidays: new Set([WED]) });
    expect(lines).toEqual([{ employeeId: 'E1', dateKey: WED, hours: 6, category: 'HS10' }]);
  });

  it('la nuit donne HS09 et sort du pool HS01/HS02', () => {
    const clocks = [
      { employeeId: 'E1', dateKey: MON, firstClock: new Date(2026, 0, 5, 14, 0), lastClock: new Date(2026, 0, 5, 23, 30) },
    ];
    const lines = run([day(MON, 9.5)], { clocks });
    expect(sum(lines, 'HS09')).toBe(1.5);
    // 1,5 h de depassement, toutes de nuit : rien en HS01-04.
    expect(sum(lines, 'HS01') + sum(lines, 'HS02') + sum(lines, 'HS03') + sum(lines, 'HS04')).toBe(0);
  });

  it('traite chaque employe separement', () => {
    const lines = run([day(MON, 10, 8, 'E1'), day(MON, 9, 8, 'E2')], {
      settings: { ...DEFAULT_TIME_SETTINGS, monthlyNiCapHours: 0 },
    });
    expect(lines.find((l) => l.employeeId === 'E1')!.hours).toBe(2);
    expect(lines.find((l) => l.employeeId === 'E2')!.hours).toBe(1);
  });
});

describe('heures supplementaires, methode hebdomadaire', () => {
  const fullWeek = [day(MON, 9), day(TUE, 9), day(WED, 9), day(THU, 9), day(FRI, 9)]; // 45 h

  it('declenche au-dela de 40 h et date la ligne du dimanche de fin de semaine', () => {
    const lines = run(fullWeek, {
      method: 'weekly',
      settings: { ...DEFAULT_TIME_SETTINGS, monthlyNiCapHours: 0 },
    });
    expect(lines).toEqual([{ employeeId: 'E1', dateKey: SUN, hours: 5, category: 'HS01' }]);
  });

  it('au-dela de 8 h supp, le reste passe a 150 %', () => {
    const lines = run([...fullWeek, day(SAT, 6, 0)], {
      method: 'weekly',
      settings: { ...DEFAULT_TIME_SETTINGS, monthlyNiCapHours: 0 },
    });
    // 51 h -> 11 h supp : 8 a 130 %, 3 a 150 %.
    expect(sum(lines, 'HS01')).toBe(8);
    expect(sum(lines, 'HS02')).toBe(3);
  });

  it('ne cloture pas une semaine dont le dimanche est hors periode', () => {
    expect(run(fullWeek, { method: 'weekly', to: SAT })).toEqual([]);
  });

  it('applique ensuite le plafond mensuel', () => {
    const lines = run(fullWeek, { method: 'weekly' });
    expect(lines).toEqual([{ employeeId: 'E1', dateKey: SUN, hours: 5, category: 'HS03' }]);
  });
});

describe('nightOverlapHours', () => {
  it('compte le chevauchement avec 22 h - 5 h', () => {
    expect(nightOverlapHours(new Date(2026, 0, 5, 20, 0), new Date(2026, 0, 6, 2, 0), MON, 22, 5)).toBe(4);
  });

  it('renvoie 0 sans chevauchement', () => {
    expect(nightOverlapHours(new Date(2026, 0, 5, 8, 0), new Date(2026, 0, 5, 17, 0), MON, 22, 5)).toBe(0);
  });
});

describe('panier', () => {
  it('un panier par jour atteignant le seuil, sans doublon avec les saisies manuelles', () => {
    const result = computePanierDays(
      [day(MON, 8), day(TUE, 7.9), day(WED, 9)],
      [
        { employeeId: 'E1', dateKey: WED }, // deja compte
        { employeeId: 'E1', dateKey: TUE }, // ajoute
      ],
      8,
      MON,
      SUN,
    );
    expect(result.map((p) => p.dateKey).sort()).toEqual([MON, TUE, WED]);
  });

  it('ignore les jours hors periode', () => {
    expect(computePanierDays([day(MON, 9)], [], 8, TUE, SUN)).toEqual([]);
  });
});

describe('permanence', () => {
  const rates = { OUVRABLE: 5000, SAMEDI: 8000, DIMANCHE_FERIE: 9000 };

  it('applique le tarif du type de jour', () => {
    const lines = computePermanenceLines(
      [MON, SAT, SUN, WED].map((dateKey) => ({ employeeId: 'E1', dateKey })),
      new Set([WED]),
      rates,
    );
    expect(lines.map((l) => l.amount)).toEqual([5000, 8000, 9000, 9000]);
  });
});

describe('export Sage', () => {
  it('totalise par matricule et par code', () => {
    const rows = buildSageRows([
      { employeeNumber: '001', codeId: 'a', code: 'HS03', sageTypeCode: 255, hours: 2 },
      { employeeNumber: '001', codeId: 'a', code: 'HS03', sageTypeCode: 255, hours: 1.5 },
      { employeeNumber: '001', codeId: 'b', code: '30900', sageTypeCode: 0, hours: 1 },
    ]);
    expect(rows).toEqual([
      { im: '001', type: 255, code: 'HS03', valeur: 3.5 },
      { im: '001', type: 0, code: '30900', valeur: 1 },
    ]);
  });

  it('refuse un code sans type Sage', () => {
    expect(() =>
      buildSageRows([{ employeeNumber: '001', codeId: 'a', code: 'HS01', sageTypeCode: null, hours: 1 }]),
    ).toThrow(/HS01/);
  });
});

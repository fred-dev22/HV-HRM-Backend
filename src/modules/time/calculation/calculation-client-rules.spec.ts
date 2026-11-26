import {
  DEFAULT_TIME_SETTINGS,
  applyMonthlyNiCap,
  computeDailyHours,
  computeOvertimeLines,
  computePanierDays,
  longestContinuousHours,
  weeklyOvertimeByDay,
  type DayHours,
  type OvertimeLine,
} from './overtime-engine';
import { buildWorkRecords } from './work-records';
import { TimeCalculationService } from './time-calculation.service';

// Semaine du lundi 2026-01-05 au dimanche 2026-01-11.
const [MON, TUE, WED, THU, FRI, SAT, SUN] = ['05', '06', '07', '08', '09', '10', '11'].map((d) => `2026-01-${d}`) as [
  string, string, string, string, string, string, string,
];
const at = (dateKey: string, time: string) => new Date(`${dateKey}T${time}:00`);
const punch = (dateKey: string, from: string, to: string, employeeId = 'E1') => ({
  employeeId, dateKey, firstClock: at(dateKey, from), lastClock: at(dateKey, to),
});
const entry = (dateKey: string, from: string, to: string, employeeId = 'E1') => ({
  employeeId, dateKey, start: at(dateKey, from), end: at(dateKey, to), hours: 0,
});
const day = (dateKey: string, workedHours: number, employeeId = 'E1'): DayHours => ({ employeeId, dateKey, workedHours, requiredHours: 8 });
const recordOf = (punches: ReturnType<typeof punch>[], entries: Parameters<typeof buildWorkRecords>[1]) =>
  [...buildWorkRecords(punches, entries).values()][0]!;
const hoursOf = (punches: ReturnType<typeof punch>[], entries: Parameters<typeof buildWorkRecords>[1], options = {}) =>
  computeDailyHours([recordOf(punches, entries)], new Set(), () => 8, () => 1, options).days[0]!.workedHours;

describe('saisies approuvees et pointeuse reunies', () => {
  it('une saisie seule compte comme temps travaille', () => {
    expect(hoursOf([], [entry(MON, '07:00', '12:00')])).toBe(5);
  });

  it('plusieurs plages le meme jour s additionnent sans le trou', () => {
    expect(hoursOf([], [entry(MON, '07:00', '12:00'), entry(MON, '13:00', '17:00')])).toBe(9);
  });

  it('une heure deja pointee ne compte pas deux fois', () => {
    expect(hoursOf([punch(MON, '07:00', '12:00')], [entry(MON, '10:00', '15:00')])).toBe(8);
  });

  it('une duree sans horaires s ajoute, plafonnee a 24 h', () => {
    expect(hoursOf([punch(MON, '07:00', '12:00')], [{ employeeId: 'E1', dateKey: MON, start: null, end: null, hours: 3 }])).toBe(8);
    expect(hoursOf([punch(MON, '00:00', '20:00')], [{ employeeId: 'E1', dateKey: MON, start: null, end: null, hours: 10 }])).toBe(24);
  });

  it('le trou entre deux plages n est pas retire une seconde fois comme pause', () => {
    expect(hoursOf([], [entry(MON, '07:00', '12:00'), entry(MON, '13:00', '17:00')], { deductBreak: true })).toBe(9);
    expect(hoursOf([punch(MON, '07:00', '17:00')], [], { deductBreak: true })).toBe(9);
  });

  it('un jour non prevu avec saisie approuvee compte toujours', () => {
    const records = [...buildWorkRecords([], [entry(SAT, '06:00', '12:00')]).values()];
    expect(computeDailyHours(records, new Set(), () => null).days).toHaveLength(1);
  });

  it('seules les saisies de travail approuvees sont lues', async () => {
    const entries = jest.fn().mockResolvedValue([]);
    const service = Object.create(TimeCalculationService.prototype) as unknown as {
      prisma: unknown;
      loadWorkRecords(from: string, to: string, ids?: string[]): Promise<unknown>;
    };
    service.prisma = { timeMorphoRecord: { findMany: jest.fn().mockResolvedValue([]) }, timeManualEntry: { findMany: entries } };
    await service.loadWorkRecords(MON, SUN, ['E1']);
    expect(entries.mock.calls[0][0].where).toMatchObject({
      Status: 'Approved',
      EntryType: { in: ['mission', 'reunion_exterieure', 'travail_hors_site', 'travail_sur_site'] },
      EmployeeId: { in: ['E1'] },
    });
  });
});

describe('heures supplementaires de la feuille de temps (hebdomadaires)', () => {
  const run = (days: DayHours[], clocks: ReturnType<typeof punch>[] = []) =>
    weeklyOvertimeByDay(days, clocks, new Set(), DEFAULT_TIME_SETTINGS);

  it("rien avant 40 h cumulees, puis le samedi en entier (ecran de l'ancienne application)", () => {
    const result = run([MON, TUE, WED, THU, FRI].map((d) => day(d, 8)).concat(day(SAT, 6)));
    expect([...result]).toEqual([[`E1|${SAT}`, 6]]);
  });

  it('une longue journee ne fait pas d heure supplementaire sous 40 h', () => {
    expect(run([day(MON, 12), day(TUE, 10)]).size).toBe(0);
  });

  it('le total de la semaine egale le calcul de paie', () => {
    const days = [MON, TUE, WED, THU, FRI].map((d) => day(d, 9.5)).concat(day(SAT, 6), day(SUN, 5));
    const paid = computeOvertimeLines({
      days, clocks: [], holidays: new Set(), settings: DEFAULT_TIME_SETTINGS, method: 'weekly', from: MON, to: SUN,
    });
    const overtime = paid.filter((l) => l.category !== 'HS10').reduce((s, l) => s + l.hours, 0);
    expect([...run(days).values()].reduce((s, h) => s + h, 0)).toBe(overtime);
    expect(overtime).toBe(13.5);
  });
});

describe('panier : service continu', () => {
  const lunch = { start: '12:00', end: '13:00' };

  it("08:00 a 16:00 saisi d'un trait donne droit au panier, meme si l'horaire a une pause", () => {
    expect(longestContinuousHours(recordOf([], [entry(MON, '08:00', '16:00')]), lunch)).toBe(8);
  });

  it('une journee pointee qui couvre la pause n est pas continue', () => {
    expect(longestContinuousHours(recordOf([punch(MON, '07:30', '17:30')], []), lunch)).toBe(4.5);
  });

  it('sans pause a l horaire, la journee pointee est continue', () => {
    expect(longestContinuousHours(recordOf([punch(MON, '05:50', '13:55')], []), null)).toBeCloseTo(8.083, 2);
  });

  it('deux saisies separees par une pause ne font pas 8 h continues', () => {
    expect(longestContinuousHours(recordOf([], [entry(MON, '07:00', '12:00'), entry(MON, '13:00', '17:00')]))).toBe(5);
  });

  it('le calcul suit la duree continue quand elle est fournie', () => {
    const days = [day(MON, 10), day(TUE, 8)];
    const continuous = (d: DayHours) => (d.dateKey === MON ? 5 : 8);
    expect(computePanierDays(days, [], 8, MON, SUN, continuous).map((p) => p.dateKey)).toEqual([TUE]);
  });
});

describe('plafond non imposable de 20 h par employe', () => {
  const line = (employeeId: string, dateKey: string, hours: number): OvertimeLine => ({ employeeId, dateKey, hours, category: 'HS01' });

  it('chaque employe a ses 20 heures', () => {
    const lines = [line('E1', SUN, 15), line('E2', SUN, 15)];
    applyMonthlyNiCap(lines, 20, false);
    expect(lines.map((l) => l.category)).toEqual(['HS03', 'HS03']);
  });

  it('les heures deja attribuees plus tot dans le mois sont deduites', () => {
    const lines = [line('E1', SUN, 8), line('E2', SUN, 8)];
    applyMonthlyNiCap(lines, 20, false, undefined, new Map([['E1|2026-01', 15]]));
    const of = (id: string) => lines.filter((l) => l.employeeId === id).map((l) => [l.category, l.hours]);
    expect(of('E1')).toEqual([['HS01', 3], ['HS03', 5]]);
    expect(of('E2')).toEqual([['HS03', 8]]);
  });

  it('par defaut le plafond n est plus partage par l entreprise', () => {
    expect(DEFAULT_TIME_SETTINGS.monthlyNiCapCompanyWide).toBe(false);
  });
});

import { workDayError } from '../../calendar/calendar-hours';
import { DaySpan, pairNightShifts } from './night-shifts';
import { computeDailyHours, longestContinuousHours, requiredHoursOfSchedule } from './overtime-engine';
import { buildWorkRecords } from './work-records';
import { TimeCalculationService } from './time-calculation.service';

// Semaine du lundi 2026-01-05.
const [SUN0, MON, TUE, WED, SAT] = ['04', '05', '06', '07', '10'].map((d) => `2026-01-${d}`) as [string, string, string, string, string];
const at = (dateKey: string, time: string) => new Date(`${dateKey}T${time}:00`);
const row = (dateKey: string, first: string, last = first, employeeId = 'E1'): DaySpan => ({
  employeeId, dateKey, first: at(dateKey, first), last: at(dateKey, last),
});
// Nuit 22:00-06:00 du lundi au vendredi.
const nights = (_e: string, key: string) =>
  [1, 2, 3, 4, 5].includes(new Date(`${key}T00:00:00Z`).getUTCDay()) ? { start: '22:00', end: '06:00' } : null;
const text = (spans: DaySpan[]) =>
  spans
    .map((s) => {
      const t = (d: Date) => `${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
      return `${s.dateKey.slice(8)} ${t(s.first)} > ${t(s.last)}${s.missing ? ` sans ${s.missing}` : ''}`;
    })
    .sort();

describe('postes de nuit et pointeuse', () => {
  it('reconstitue chaque nuit avec le soir du jour et le matin du lendemain', () => {
    const rows = [row(MON, '21:55'), row(TUE, '06:05', '21:50'), row(WED, '06:00')];
    expect(text(pairNightShifts(rows, nights))).toEqual(['05 05 21:55 > 06 06:05', '06 06 21:50 > 07 06:00']);
  });

  it('la sortie du samedi matin appartient au vendredi, le samedi disparait', () => {
    const rows = [row('2026-01-09', '22:00'), row(SAT, '06:10')];
    expect(text(pairNightShifts(rows, nights))).toEqual(['09 09 22:00 > 10 06:10']);
  });

  it('un passage manquant est signale sans inventer d heures', () => {
    const noExit = pairNightShifts([row(MON, '22:00')], nights);
    expect(text(noExit)).toEqual(['05 05 22:00 > 05 22:00 sans end']);
    // Seule la sortie du lendemain est connue : le jour est reconstitue quand meme.
    const noEntry = pairNightShifts([row(TUE, '06:00')], nights);
    expect(text(noEntry)).toEqual(['05 06 06:00 > 06 06:00 sans start']);
  });

  it('un passage l apres-midi d un jour de repos reste sur sa date', () => {
    const rows = [row(SUN0, '14:00', '18:00')];
    expect(text(pairNightShifts(rows, nights))).toEqual(['04 04 14:00 > 04 18:00']);
  });

  it('un employe sans horaire de nuit garde ses lignes telles quelles', () => {
    const rows = [row(MON, '07:00', '16:00'), row(TUE, '07:00', '16:00')];
    expect(text(pairNightShifts(rows, () => null))).toEqual(['05 05 07:00 > 05 16:00', '06 06 07:00 > 06 16:00']);
  });

  it('un fichier qui donne deja la sortie du lendemain est garde', () => {
    const rows: DaySpan[] = [{ employeeId: 'E1', dateKey: MON, first: at(MON, '22:00'), last: at(TUE, '06:00') }];
    expect(text(pairNightShifts(rows, nights))).toEqual(['05 05 22:00 > 06 06:00']);
  });
});

describe('calcul d un poste de nuit', () => {
  const record = () => {
    const [span] = pairNightShifts([row(MON, '22:00'), row(TUE, '06:00')], nights);
    return [...buildWorkRecords([{ employeeId: 'E1', dateKey: MON, firstClock: span!.first, lastClock: span!.last }], []).values()][0]!;
  };

  it('heures prevues, pause avant ou apres minuit comprise', () => {
    const day = { isWorkingDay: true, startTime: '22:00', endTime: '06:00' };
    expect(requiredHoursOfSchedule(day)).toBe(8);
    expect(requiredHoursOfSchedule({ ...day, breakStart: '01:00', breakEnd: '02:00' })).toBe(7);
    expect(requiredHoursOfSchedule({ ...day, breakStart: '23:30', breakEnd: '00:30' })).toBe(7);
  });

  it('8 h le jour de la prise de poste, la pause d apres minuit retiree si le reglage est actif', () => {
    const hours = (pause: { start: string; end: string; nextDay?: boolean }, deductBreak: boolean) =>
      computeDailyHours([record()], new Set(), () => 8, () => pause, { deductBreak }).days[0]!;
    expect(hours({ start: '01:00', end: '02:00', nextDay: true }, false)).toMatchObject({ dateKey: MON, workedHours: 8 });
    expect(hours({ start: '01:00', end: '02:00', nextDay: true }, true).workedHours).toBe(7);
    expect(hours({ start: '23:30', end: '00:30' }, true).workedHours).toBe(7);
  });

  it('la pause d apres minuit coupe le service continu', () => {
    expect(longestContinuousHours(record(), null)).toBe(8);
    expect(longestContinuousHours(record(), { start: '02:00', end: '03:00', nextDay: true })).toBe(4);
  });
});

describe('chargement des pointages', () => {
  function build(workDays: { StartTime: Date; EndTime: Date }[]) {
    const findMany = jest.fn().mockResolvedValue(
      [row(MON, '22:00'), row(TUE, '06:00')].map((s) => ({
        EmployeeId: s.employeeId, DateJour: new Date(`${s.dateKey}T00:00:00Z`), PremierPointage: s.first, DernierPointage: s.last,
      })),
    );
    const service = Object.create(TimeCalculationService.prototype) as unknown as Pick<TimeCalculationService, 'loadPunchSpans'> & {
      prisma: unknown;
      scheduleOf: jest.Mock;
    };
    service.prisma = { timeMorphoRecord: { findMany }, calendarWorkDay: { findMany: jest.fn().mockResolvedValue(workDays) } };
    service.scheduleOf = jest.fn().mockResolvedValue({ hours: Array(7).fill({ start: '22:00', end: '06:00' }) });
    return { service, findMany };
  }
  const time = (t: string) => new Date(`1970-01-01T${t}:00Z`);

  it('lit la veille et le lendemain de la periode, puis ne rend que la periode', async () => {
    const { service, findMany } = build([{ StartTime: time('22:00'), EndTime: time('06:00') }]);
    const spans = await service.loadPunchSpans(MON, MON, ['E1']);
    expect(findMany.mock.calls[0][0].where.DateJour).toEqual({ gte: new Date('2026-01-04T00:00:00Z'), lte: new Date('2026-01-06T00:00:00Z') });
    expect(text(spans)).toEqual(['05 05 22:00 > 06 06:00']);
  });

  it('sans horaire de nuit, rien n est reconstitue ni resolu', async () => {
    const { service } = build([{ StartTime: time('07:00'), EndTime: time('16:00') }]);
    expect(await service.loadPunchSpans(MON, TUE, ['E1'])).toHaveLength(2);
    expect(service.scheduleOf).not.toHaveBeenCalled();
  });
});

describe('coherence des horaires', () => {
  const m = (h: number) => h * 60;
  it('jour et nuit', () => {
    expect(workDayError(m(8), m(17), { start: m(12), end: m(13) })).toBeNull();
    expect(workDayError(m(22), m(6), { start: m(1), end: m(2) })).toBeNull();
    expect(workDayError(m(22), m(6), { start: m(23), end: m(1) })).toBeNull();
    expect(workDayError(m(8), m(8))).toContain('différente');
    expect(workDayError(m(18), m(10))).toBeNull();
    expect(workDayError(m(18), m(17))).toContain('16 h');
    expect(workDayError(m(22), m(6), { start: m(12), end: m(13) })).toContain("après l'heure de fin");
    expect(workDayError(m(8), m(17), { start: m(7), end: m(9) })).toContain("avant l'heure de début");
    expect(workDayError(m(8), m(17), { start: m(13), end: m(12) })).toContain('après avoir commencé');
  });
});

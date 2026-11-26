import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { DayPunch, punchFromDates, recordFromPunches } from '../calculation/day-punches';
import { computeDailyHours, longestContinuousHours, nightOverlapHours } from '../calculation/overtime-engine';
import { planLines } from '../entries/entry-lines';
import { TimeWeekService, correctedPunches, isoWeekNumber } from './time-week.service';
import { assertWeekOpen, removeControl, weekKey } from './week-lock';

const DAY = '2026-11-16';
const punch = (start: string | null, end: string | null, source: DayPunch['source'] = 'Morpho', nextDay = false): DayPunch => ({
  start, end, source, nextDay,
});

describe('pointages d un jour', () => {
  it('une sortie le lendemain donne les heures de nuit', () => {
    const record = recordFromPunches('a', DAY, [punch('21:00', '05:00', 'Corrected', true)], 0);
    expect(computeDailyHours([record], new Set(), () => 8).days[0]!.workedHours).toBe(8);
    expect(nightOverlapHours(record.firstClock, record.lastClock, DAY, 22, 5)).toBe(7);
  });

  it('une pointeuse au lendemain est reconnue', () => {
    expect(punchFromDates(new Date(`${DAY}T21:00:00`), new Date('2026-11-17T05:00:00'), DAY, 'Morpho')).toMatchObject({
      start: '21:00', end: '05:00', nextDay: true,
    });
  });

  it('la pause ne s applique qu a une paire restee celle de la pointeuse', () => {
    const lunch = { start: '12:00', end: '13:00' };
    expect(longestContinuousHours(recordFromPunches('a', DAY, [punch('07:00', '17:00')], 0), lunch)).toBe(5);
    expect(longestContinuousHours(recordFromPunches('a', DAY, [punch('07:00', '17:00', 'Corrected')], 0), lunch)).toBe(10);
  });

  it('un jour vide compte 0 h et reste un jour revu', () => {
    const record = recordFromPunches('a', DAY, [], 0);
    expect(computeDailyHours([record], new Set(), () => null).days[0]!.workedHours).toBe(0);
  });

  it('une paire incomplete ne compte pas', () => {
    expect(computeDailyHours([recordFromPunches('a', DAY, [punch('07:00', null)], 0)], new Set(), () => 8).days[0]!.workedHours).toBe(0);
  });
});

describe('corrections envoyees par l ecran', () => {
  const current = [punch('07:00', '12:00')];

  it('une paire inchangee garde son origine, une nouvelle est corrigee, dans l ordre', () => {
    const result = correctedPunches(DAY, [{ Start: '13:00', End: '17:00' }, { Start: '07:00', End: '12:00' }], current);
    expect(result.map((p) => [p.start, p.source])).toEqual([['07:00', 'Morpho'], ['13:00', 'Corrected']]);
  });

  it('refuse un chevauchement et une sortie avant l entree', () => {
    expect(() => correctedPunches(DAY, [{ Start: '07:00', End: '12:00' }, { Start: '11:00', End: '17:00' }], [])).toThrow(BadRequestException);
    expect(() => correctedPunches(DAY, [{ Start: '17:00', End: '08:00' }], [])).toThrow(BadRequestException);
  });

  it('accepte la sortie du lendemain et ignore les paires vides', () => {
    expect(correctedPunches(DAY, [{ Start: '21:00', End: '05:00', NextDay: true }, {}], [])).toEqual([punch('21:00', '05:00', 'Corrected', true)]);
  });
});

describe('semaine validee ou controlee', () => {
  it('numero de semaine ISO', () => {
    expect(isoWeekNumber('2025-12-29')).toBe(1);
    expect(isoWeekNumber('2026-11-16')).toBe(47);
  });

  it('une semaine validee refuse toute modification', async () => {
    const prisma = { timeWeekValidation: { findFirst: jest.fn().mockResolvedValue({ Id: 'v' }) } };
    await expect(assertWeekOpen(prisma as never, 'a', '2026-11-18')).rejects.toThrow('16/11/2026');
    expect(prisma.timeWeekValidation.findFirst.mock.calls[0][0].where).toMatchObject({ Status: 'Validated' });
  });

  it('les saisies d une semaine validee sont refusees ligne par ligne', () => {
    const [r] = planLines({
      lines: [{
        employee: { id: 'a', name: 'A', number: 'a', isInactive: false, hireDate: null, terminationDate: null, hasRoute: true },
        dateKey: DAY, slot: { entryType: 'mission', start: 480, end: 720, hours: 4 },
      }],
      scope: null, actorId: 'rh', existing: [], punches: [], leaveDays: new Set(), today: '2026-11-26',
      lockedDays: new Set([`a|${DAY}`]),
    });
    expect(r).toMatchObject({ action: 'error', message: expect.stringContaining('validée') });
    expect(weekKey('A', '2026-11-18')).toBe(`a|${DAY}`);
  });

  it('un changement retire le controle et le note', async () => {
    const prisma = {
      timeWeekValidation: { deleteMany: jest.fn().mockResolvedValue({ count: 1 }) },
      timeWeekHistory: { create: jest.fn() },
    };
    await removeControl(prisma as never, 'a', '2026-11-18', 'chef', 'motif');
    expect(prisma.timeWeekValidation.deleteMany.mock.calls[0][0].where.Status).toBe('Controlled');
    expect(prisma.timeWeekHistory.create.mock.calls[0][0].data.Action).toBe('UNCONTROL');
  });

  it('un manager ne voit pas la semaine d un employe hors equipe', async () => {
    const service = new TimeWeekService({} as never, { teamEmployeeIds: jest.fn().mockResolvedValue(['equipier']) } as never);
    await expect(service.week('autre', DAY, 'chef', new Set(['TEMPS_VALIDER']))).rejects.toBeInstanceOf(ForbiddenException);
  });
});

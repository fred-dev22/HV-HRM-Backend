import { ConflictException, ForbiddenException } from '@nestjs/common';
import { computeDailyHours, deductTravel, longestContinuousHours, nightOverlapHours } from '../calculation/overtime-engine';
import { DayPunch, recordFromPunches } from '../calculation/day-punches';
import { buildWorkRecords } from '../calculation/work-records';
import { TimeCalculationService } from '../calculation/time-calculation.service';
import { correctedPunches } from '../weeks/time-week.service';
import { TimeSitesController } from './time-sites.controller';
import { TimeSitesService } from './time-sites.service';

const DAY = '2026-11-16';
const at = (time: string, dateKey = DAY) => new Date(`${dateKey}T${time}:00`);
const morpho = (from: string, to: string) => ({ employeeId: 'a', dateKey: DAY, firstClock: at(from), lastClock: at(to) });
const entry = (from: string, to: string, remote: boolean) => ({
  employeeId: 'a', dateKey: DAY, start: at(from), end: at(to), hours: 0, remote,
});
const record = (punches: ReturnType<typeof morpho>[], entries: ReturnType<typeof entry>[] = []) =>
  [...buildWorkRecords(punches, entries).values()][0]!;
const hhmm = (d: Date) => d.toTimeString().slice(0, 5);
const periods = (r: ReturnType<typeof record>) => r.intervals!.map((i) => `${hhmm(i.start)}-${hhmm(i.end)}`);
const worked = (r: ReturnType<typeof record>) => computeDailyHours([r], new Set(), () => 8).days[0]!.workedHours;

describe('trajet et changement par site', () => {
  it("exemple de la reunion : 07:00-17:30 avec 15 min devient 07:15-17:15", () => {
    const r = deductTravel(record([morpho('07:00', '17:30')]), 15);
    expect(periods(r)).toEqual(['07:15-17:15']);
    expect(worked(r)).toBe(10);
    expect(r.travelHours).toBe(0.5);
    expect([hhmm(r.badge!.start), hhmm(r.badge!.end)]).toEqual(['07:00', '17:30']);
  });

  it('une seule fois par jour : premiere arrivee et dernier depart', () => {
    const r = deductTravel(record([], [entry('07:00', '12:00', false), entry('13:00', '17:30', false)]), 15);
    expect(periods(r)).toEqual(['07:15-12:00', '13:00-17:15']);
  });

  it('rien sur le travail hors site, meme le meme jour', () => {
    const alone = record([], [entry('08:00', '16:00', true)]);
    expect(deductTravel(alone, 15)).toBe(alone);
    const mixed = deductTravel(record([morpho('07:00', '12:00')], [entry('13:00', '18:00', true)]), 15);
    expect(periods(mixed)).toEqual(['07:15-11:45', '13:00-18:00']);
  });

  it('une presence plus courte que le trajet ne compte rien', () => {
    expect(worked(deductTravel(record([morpho('07:00', '07:20')]), 15))).toBe(0);
  });

  it('les heures de nuit partent de l heure effective', () => {
    const night = recordFromPunches('a', DAY, [{ start: '14:00', end: '23:00', nextDay: false, source: 'Morpho' }], 0);
    const r = deductTravel(night, 15);
    expect(nightOverlapHours(r.firstClock, r.lastClock, DAY, 22, 5)).toBe(0.75);
  });

  it('le panier demande 8 h effectives', () => {
    expect(longestContinuousHours(deductTravel(record([morpho('07:00', '15:00')]), 15))).toBe(7.5);
  });

  it('une periode hors site corrigee reste hors site, une nouvelle est sur site', () => {
    const current: DayPunch[] = [{ start: '08:00', end: '12:00', nextDay: false, source: 'Manual', onSite: false }];
    const result = correctedPunches(DAY, [{ Start: '08:00', End: '12:30' }, { Start: '14:00', End: '17:00' }], current);
    expect(result.map((p) => p.onSite)).toEqual([false, undefined]);
  });

  it('seuls les non-cadres rattaches a un site sont concernes', async () => {
    const findMany = jest.fn().mockResolvedValue([{ Id: 'a', timeSite: { DeductionMinutes: 15 } }]);
    const service = Object.create(TimeCalculationService.prototype) as unknown as Pick<TimeCalculationService, 'loadTravelMinutes'> & {
      prisma: unknown;
    };
    service.prisma = { employee: { findMany } };
    expect(await service.loadTravelMinutes(['a', 'b'])).toEqual(new Map([['a', 15]]));
    expect(findMany.mock.calls[0][0].where).toMatchObject({ IsCadre: false, TimeSiteId: { not: null } });
  });
});

describe('gestion des sites', () => {
  it('un site occupe ne se supprime pas', async () => {
    const service = new TimeSitesService({
      timeSite: { findUnique: jest.fn().mockResolvedValue({ Id: 's' }) },
      employee: { count: jest.fn().mockResolvedValue(3) },
    } as never);
    await expect(service.remove('s')).rejects.toBeInstanceOf(ConflictException);
  });

  it('la liste est lisible pour remplir une fiche, pas par un employe simple', () => {
    const controller = new TimeSitesController({ findAll: jest.fn() } as never);
    expect(() => controller.findAll(new Set(['EMPLOYE_MODIFIER']))).not.toThrow();
    expect(() => controller.findAll(new Set(['TEMPS_SAISIR']))).toThrow(ForbiddenException);
  });
});

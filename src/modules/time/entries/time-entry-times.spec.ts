import { BadRequestException } from '@nestjs/common';
import { resolveTimes } from './time-entry.service';

describe('resolveTimes', () => {
  it('deduit la duree de l\'heure de debut et de fin', () => {
    const r = resolveTimes('2026-11-02', undefined, '08:00', '17:30');
    expect(r.hours).toBe(9.5);
    expect(r.clockIn).toEqual(new Date('2026-11-02T08:00:00'));
    expect(r.clockOut).toEqual(new Date('2026-11-02T17:30:00'));
  });

  it('arrondit au centieme d\'heure', () => {
    expect(resolveTimes('2026-11-02', undefined, '08:00', '08:20').hours).toBe(0.33);
  });

  it('garde la duree declaree quand il n\'y a pas d\'horaires', () => {
    const r = resolveTimes('2026-11-02', 3, undefined, undefined);
    expect(r).toEqual({ hours: 3, clockIn: null, clockOut: null });
  });

  it('refuse une saisie sans duree ni horaires', () => {
    expect(() => resolveTimes('2026-11-02', undefined)).toThrow(BadRequestException);
  });

  it('refuse un seul horaire, ou une fin avant le debut', () => {
    expect(() => resolveTimes('2026-11-02', undefined, '08:00', undefined)).toThrow(BadRequestException);
    expect(() => resolveTimes('2026-11-02', undefined, '18:00', '08:00')).toThrow(BadRequestException);
    expect(() => resolveTimes('2026-11-02', undefined, '08:00', '08:00')).toThrow(BadRequestException);
  });
});

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

  it("accepte une entree ou une sortie seule, sans duree (a completer)", () => {
    expect(resolveTimes('2026-11-02', undefined, '08:00', undefined)).toEqual({ hours: 0, clockIn: new Date('2026-11-02T08:00:00'), clockOut: null });
    expect(resolveTimes('2026-11-02', undefined, undefined, '17:00')).toMatchObject({ hours: 0, clockIn: null });
    expect(() => resolveTimes('2026-11-02', 4, '08:00', undefined)).toThrow(BadRequestException);
  });

  it('une fin avant le debut est un poste de nuit : la sortie a lieu le lendemain', () => {
    const r = resolveTimes('2026-11-30', undefined, '22:00', '06:00');
    expect(r.hours).toBe(8);
    expect(r.clockIn).toEqual(new Date('2026-11-30T22:00:00'));
    expect(r.clockOut).toEqual(new Date('2026-12-01T06:00:00'));
    expect(resolveTimes('2026-11-02', undefined, '18:00', '10:00').hours).toBe(16);
  });

  it('refuse une fin egale au debut et une nuit de plus de 16 h', () => {
    expect(() => resolveTimes('2026-11-02', undefined, '08:00', '08:00')).toThrow('différente');
    expect(() => resolveTimes('2026-11-02', undefined, '13:00', '12:00')).toThrow('16 h');
  });
});

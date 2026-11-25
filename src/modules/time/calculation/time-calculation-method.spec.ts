import { BadRequestException } from '@nestjs/common';
import { TimeCalculationService } from './time-calculation.service';

// Le calcul des heures supplementaires se fait uniquement a la semaine, quel que
// soit le reglage 'overtime_method' encore present en base.
describe('TimeCalculationService.resolveMethod', () => {
  const build = (value?: number) => {
    const service = Object.create(TimeCalculationService.prototype) as unknown as {
      prisma: unknown;
      resolveMethod(requested?: 'daily' | 'weekly'): Promise<'daily' | 'weekly'>;
    };
    service.prisma = { timeSetting: { findUnique: jest.fn().mockResolvedValue(value === undefined ? null : { Value: value }) } };
    return service;
  };

  it.each([undefined, 0, 1, 2])('reglage %s en base : toujours hebdomadaire', async (value) => {
    const s = build(value);
    await expect(s.resolveMethod()).resolves.toBe('weekly');
    await expect(s.resolveMethod('weekly')).resolves.toBe('weekly');
  });

  it('refuse explicitement le mode journalier', async () => {
    await expect(build(0).resolveMethod('daily')).rejects.toBeInstanceOf(BadRequestException);
  });
});

import { BadRequestException } from '@nestjs/common';
import { TimeCalculationService } from './time-calculation.service';

// La methode de calcul des heures supplementaires est un reglage client : une
// methode fixe n'accepte pas une demande differente (elle change la paie).
describe('TimeCalculationService.resolveMethod', () => {
  const build = (value?: number) => {
    const service = Object.create(TimeCalculationService.prototype) as unknown as {
      prisma: unknown;
      resolveMethod(requested?: 'daily' | 'weekly'): Promise<'daily' | 'weekly'>;
    };
    service.prisma = { timeSetting: { findUnique: jest.fn().mockResolvedValue(value === undefined ? null : { Value: value }) } };
    return service;
  };

  it('journalier fixe : utilise le journalier, refuse l\'hebdomadaire demande', async () => {
    const s = build(0);
    await expect(s.resolveMethod()).resolves.toBe('daily');
    await expect(s.resolveMethod('daily')).resolves.toBe('daily');
    await expect(s.resolveMethod('weekly')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('hebdomadaire fixe : utilise l\'hebdomadaire, refuse le journalier demande', async () => {
    const s = build(1);
    await expect(s.resolveMethod()).resolves.toBe('weekly');
    await expect(s.resolveMethod('daily')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('les deux : la methode demandee est utilisee, journalier par defaut', async () => {
    const s = build(2);
    await expect(s.resolveMethod('weekly')).resolves.toBe('weekly');
    await expect(s.resolveMethod('daily')).resolves.toBe('daily');
    await expect(s.resolveMethod()).resolves.toBe('daily');
  });

  it('reglage absent : journalier (historique)', async () => {
    await expect(build().resolveMethod()).resolves.toBe('daily');
  });
});

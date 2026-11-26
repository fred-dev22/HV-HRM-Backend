import { DashboardService } from '../../dashboard/dashboard.service';
import { OVERTIME_ONLY } from './pay-codes';

// Un panier est un nombre, une permanence un montant, HS09 et HS10 des
// majorations : rien de cela n'entre dans un total d'heures supplementaires.
describe("totaux d'heures supplementaires", () => {
  it('le filtre ne retient que HS01 a HS04', () => {
    expect(OVERTIME_ONLY.code.Code.in).toEqual(['HS01', 'HS02', 'HS03', 'HS04']);
  });

  it('le tableau de bord ne somme que les lignes en heures', async () => {
    const aggregate = jest.fn().mockResolvedValue({ _sum: { Hours: 10 } });
    const prisma = {
      timeManualEntry: { count: jest.fn().mockResolvedValue(0) },
      timeMorphoRecord: { groupBy: jest.fn().mockResolvedValue([]) },
      timeDailyHours: { aggregate: jest.fn().mockResolvedValue({ _sum: {} }) },
      timeOvertime: { aggregate },
      timeMorphoImport: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const service = Object.create(DashboardService.prototype) as {
      prisma: unknown;
      timeCounts(start: Date, next: Date, today: Date): Promise<{ overtimeHoursMonth: number }>;
    };
    service.prisma = prisma;
    const r = await service.timeCounts(new Date('2026-11-01'), new Date('2026-12-01'), new Date('2026-11-25'));
    expect(r.overtimeHoursMonth).toBe(10);
    expect(aggregate.mock.calls[0][0].where.code).toEqual(OVERTIME_ONLY.code);
  });
});

import { TimeCalculationService } from './time-calculation.service';

// Les cadres n'apparaissent ni dans le rapport ni dans l'export Sage, meme si des
// lignes de paie ont ete calculees avant qu'ils soient marques cadres.
describe('export paie : exclusion des cadres', () => {
  const build = () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const service = Object.create(TimeCalculationService.prototype) as unknown as {
      prisma: unknown;
      sageRows(from: string, to: string): Promise<unknown>;
      overtimeReport(from: string, to: string): Promise<unknown>;
    };
    service.prisma = { timeOvertime: { findMany } };
    return { service, findMany };
  };

  it("l'export Sage ne lit que les employes non cadres", async () => {
    const { service, findMany } = build();
    await service.sageRows('2026-01-01', '2026-01-31');
    expect(findMany.mock.calls[0][0].where.employee).toEqual({ IsCadre: false });
  });

  it('le rapport ne lit que les employes non cadres', async () => {
    const { service, findMany } = build();
    await service.overtimeReport('2026-01-01', '2026-01-31');
    expect(findMany.mock.calls[0][0].where.employee).toEqual({ IsCadre: false });
  });
});

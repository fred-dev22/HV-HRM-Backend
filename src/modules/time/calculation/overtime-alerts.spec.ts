import { ForbiddenException } from '@nestjs/common';
import { TimeCalculationController } from './time-calculation.controller';
import { TimeCalculationService } from './time-calculation.service';

// Alerte au manager : employes ayant atteint 60 h d'heures supplementaires dans
// le mois (plafond legal 80 h), d'apres le calcul hebdomadaire.
describe('alerte heures supplementaires', () => {
  function build(totals: [string, number][], settings: { Key: string; Value: number }[] = []) {
    const groupBy = jest.fn().mockResolvedValue(totals.map(([id, h]) => ({ EmployeeId: id, _sum: { Hours: h } })));
    const findMany = jest.fn(async ({ where }) =>
      (where.Id.in as string[]).map((id) => ({ Id: id, FullName: id.toUpperCase(), EmployeeNumber: id })),
    );
    const service = Object.create(TimeCalculationService.prototype) as unknown as Pick<TimeCalculationService, 'overtimeAlerts'> & {
      prisma: unknown;
    };
    service.prisma = {
      timeSetting: { findMany: jest.fn().mockResolvedValue(settings) },
      timeOvertime: { groupBy, aggregate: jest.fn().mockResolvedValue({ _max: { Date: new Date('2026-11-15T00:00:00Z') } }) },
      employee: { findMany },
    };
    return { service, groupBy, findMany };
  }

  it('retient a partir de 60 h, du plus charge au moins charge, et signale le plafond de 80 h', async () => {
    const { service } = build([['a', 59.99], ['b', 60], ['c', 82], ['d', 71.5]]);
    const r = await service.overtimeAlerts(null, '2026-11');
    expect(r).toMatchObject({ Month: '2026-11', AlertHours: 60, LegalHours: 80, LastCalculatedDate: '2026-11-15' });
    expect(r.Employees.map((e) => [e.EmployeeId, e.Hours, e.LegalCapReached])).toEqual([
      ['c', 82, true], ['d', 71.5, false], ['b', 60, false],
    ]);
  });

  it('suit les seuils regles en base', async () => {
    const { service } = build([['a', 45]], [{ Key: 'overtime_alert_hours', Value: 40 }, { Key: 'overtime_legal_cap_hours', Value: 45 }]);
    const r = await service.overtimeAlerts(null, '2026-11');
    expect(r.Employees).toEqual([expect.objectContaining({ EmployeeId: 'a', LegalCapReached: true })]);
  });

  it('compte HS01 a HS04 seulement, sans les majorations, les cadres ni les primes', async () => {
    const { service, groupBy } = build([]);
    await service.overtimeAlerts(['a'], '2026-12');
    const where = groupBy.mock.calls[0][0].where;
    expect(where.code.Code.in).toEqual(['HS01', 'HS02', 'HS03', 'HS04']);
    expect(where.employee.IsCadre).toBe(false);
    expect(where.EmployeeId).toEqual({ in: ['a'] });
    expect(where.Date).toEqual({ gte: new Date('2026-12-01T00:00:00Z'), lt: new Date('2027-01-01T00:00:00Z') });
  });

  it('ne lit aucun nom quand personne ne depasse le seuil', async () => {
    const { service, findMany } = build([['a', 10]]);
    expect((await service.overtimeAlerts(null, '2026-11')).Employees).toEqual([]);
    expect(findMany).not.toHaveBeenCalled();
  });

  describe('acces', () => {
    const controller = (service: Record<string, jest.Mock>) => new TimeCalculationController(service as never);
    const service = () => ({ overtimeAlerts: jest.fn(), teamEmployeeIds: jest.fn().mockResolvedValue(['x']) });

    it('un manager ne voit que son equipe', async () => {
      const s = service();
      await controller(s).overtimeAlerts({}, 'moi', new Set(['TEMPS_VALIDER']));
      expect(s.overtimeAlerts).toHaveBeenCalledWith(['x'], undefined);
    });

    it('le RH voit toute l entreprise', async () => {
      const s = service();
      await controller(s).overtimeAlerts({ Month: '2026-11' }, 'moi', new Set(['TEMPS_ACCES']));
      expect(s.overtimeAlerts).toHaveBeenCalledWith(null, '2026-11');
      expect(s.teamEmployeeIds).not.toHaveBeenCalled();
    });

    it('un employe sans droit est refuse', async () => {
      await expect(controller(service()).overtimeAlerts({}, 'moi', new Set(['TEMPS_SAISIR']))).rejects.toBeInstanceOf(ForbiddenException);
    });
  });
});

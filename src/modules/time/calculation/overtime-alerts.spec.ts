import { ForbiddenException } from '@nestjs/common';
import { TimeCalculationController } from './time-calculation.controller';
import { TimeCalculationService } from './time-calculation.service';

// Carte des tableaux de bord : employes dont les heures supplementaires du mois
// (semaines rattachees au mois de leur dimanche) atteignent le seuil d'alerte.
describe('alerte heures supplementaires : tableau de bord', () => {
  function build(totals: [string, number][], settings: { Key: string; Value: number }[] = []) {
    const findMany = jest.fn(async ({ where }) =>
      where.Id?.in
        ? (where.Id.in as string[]).map((id) => ({ Id: id, FullName: id.toUpperCase(), EmployeeNumber: id }))
        : totals.map(([id]) => ({ Id: id })),
    );
    const service = Object.create(TimeCalculationService.prototype) as unknown as Pick<TimeCalculationService, 'overtimeAlerts' | 'monthlyOvertime'> & {
      prisma: unknown;
      weeklyOvertime: jest.Mock;
    };
    service.prisma = {
      timeSetting: { findMany: jest.fn().mockResolvedValue(settings) },
      timeDailyHours: { aggregate: jest.fn().mockResolvedValue({ _max: { Date: new Date('2026-11-15T00:00:00Z') } }) },
      employee: { findMany },
    };
    service.weeklyOvertime = jest.fn().mockResolvedValue(new Map(totals.map(([id, h]) => [`${id}|2026-11-06`, h])));
    return { service, findMany };
  }

  it('par defaut previent a partir de 20 h, du plus charge au moins charge', async () => {
    const { service } = build([['a', 19.99], ['b', 20], ['c', 32]]);
    const r = await service.overtimeAlerts(null, '2026-11');
    expect(r).toMatchObject({ Month: '2026-11', AlertHours: 20, LegalHours: 20, LastCalculatedDate: '2026-11-15' });
    expect(r.Employees.map((e) => [e.EmployeeId, e.Hours, e.LegalCapReached])).toEqual([['c', 32, true], ['b', 20, true]]);
  });

  it('suit les seuils regles en base', async () => {
    const { service } = build([['a', 45]], [{ Key: 'overtime_alert_hours', Value: 40 }, { Key: 'overtime_legal_cap_hours', Value: 60 }]);
    const r = await service.overtimeAlerts(null, '2026-11');
    expect(r.Employees).toEqual([expect.objectContaining({ EmployeeId: 'a', LegalCapReached: false })]);
  });

  it('prend les semaines dont le dimanche tombe dans le mois', async () => {
    const { service } = build([['a', 1]]);
    await service.monthlyOvertime(['a'], '2026-11');
    // Novembre 2026 : premier dimanche le 1er (semaine du 26/10), dernier le 29.
    expect(service.weeklyOvertime).toHaveBeenCalledWith(['a'], '2026-10-26', '2026-11-29');
  });

  describe('acces', () => {
    const controller = (service: Record<string, jest.Mock>) => new TimeCalculationController(service as never);
    const service = () => ({ overtimeAlerts: jest.fn(), alertTeamIds: jest.fn().mockResolvedValue(['x']) });

    it('un manager ne voit que son equipe, pools et interims compris', async () => {
      const s = service();
      await controller(s).overtimeAlerts({}, 'moi', new Set(['TEMPS_VALIDER']));
      expect(s.overtimeAlerts).toHaveBeenCalledWith(['x'], undefined);
      expect(s.alertTeamIds).toHaveBeenCalledWith('moi');
    });

    it('le RH voit toute l entreprise', async () => {
      const s = service();
      await controller(s).overtimeAlerts({ Month: '2026-11' }, 'moi', new Set(['TEMPS_ACCES']));
      expect(s.overtimeAlerts).toHaveBeenCalledWith(null, '2026-11');
      expect(s.alertTeamIds).not.toHaveBeenCalled();
    });

    it('un employe sans droit est refuse', async () => {
      await expect(controller(service()).overtimeAlerts({}, 'moi', new Set(['TEMPS_SAISIR']))).rejects.toBeInstanceOf(ForbiddenException);
    });
  });
});

// Point 34 : les validateurs de pool et les interimaires voient aussi l'alerte.
describe('equipe suivie par les alertes', () => {
  function build(poolMembers: { EmployeeId: string; InterimEmployeeId: string | null }[]) {
    const service = Object.create(TimeCalculationService.prototype) as unknown as Pick<TimeCalculationService, 'alertTeamIds'> & {
      prisma: unknown;
      teamEmployeeIds: jest.Mock;
      loadOrganizationAncestors: jest.Mock;
    };
    service.teamEmployeeIds = jest.fn().mockResolvedValue(['direct']);
    service.loadOrganizationAncestors = jest.fn().mockResolvedValue(
      new Map([['atelier', new Set(['atelier', 'usine'])], ['bureau', new Set(['bureau', 'siege'])]]),
    );
    service.prisma = {
      approvalPool: { findMany: jest.fn().mockResolvedValue([{ OrganizationUnitId: 'usine', members: poolMembers }]) },
      employee: {
        findMany: jest.fn(async ({ where }) =>
          where.directValidator
            ? [{ Id: 'remplace' }]
            : [{ Id: 'ouvrier', OrganizationUnitId: 'atelier' }, { Id: 'employe', OrganizationUnitId: 'bureau' }, { Id: 'moi', OrganizationUnitId: 'atelier' }],
        ),
      },
    };
    return service;
  }

  it("un membre de pool suit les employes de son entite et de ses sous-entites, en plus de son interim", async () => {
    const ids = await build([{ EmployeeId: 'moi', InterimEmployeeId: null }]).alertTeamIds('moi');
    expect(ids.sort()).toEqual(['direct', 'ouvrier', 'remplace']);
  });

  it("l'interimaire d'un membre de pool aussi", async () => {
    const ids = await build([{ EmployeeId: 'autre', InterimEmployeeId: 'moi' }]).alertTeamIds('moi');
    expect(ids).toContain('ouvrier');
  });

  it("hors du pool, rien de plus que l'equipe et l'interim direct", async () => {
    const ids = await build([{ EmployeeId: 'autre', InterimEmployeeId: null }]).alertTeamIds('moi');
    expect(ids.sort()).toEqual(['direct', 'remplace']);
  });
});

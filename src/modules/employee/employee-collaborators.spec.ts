import { EmployeeService } from './employee.service';

// "Mon equipe" d'un manager : employes de l'entite qu'il dirige (sans les
// sous-entites) + ceux dont il valide les demandes (validateur direct ou membre
// du pool d'approbation de leur entite), jamais lui-meme.
describe('EmployeeService.findCollaborators', () => {
  function build(managedUnits: string[], poolUnits: string[], employees: Record<string, unknown>[]) {
    const prisma = {
      organizationUnit: { findMany: jest.fn().mockResolvedValue(managedUnits.map((Id) => ({ Id }))) },
      approvalPool: { findMany: jest.fn().mockResolvedValue(poolUnits.map((OrganizationUnitId) => ({ OrganizationUnitId }))) },
      employee: { findMany: jest.fn().mockResolvedValue(employees) },
    };
    return { service: new EmployeeService(prisma as never, {} as never, {} as never), prisma };
  }

  it('indique le motif : entite dirigee, validateur direct, pool (cumulables)', async () => {
    const { service, prisma } = build(['A'], ['B', 'A'], [
      { Id: 'e1', OrganizationUnitId: 'A', DirectValidatorId: null },
      { Id: 'e2', OrganizationUnitId: 'Z', DirectValidatorId: 'mgr' },
      { Id: 'e3', OrganizationUnitId: 'B', DirectValidatorId: null },
      { Id: 'e4', OrganizationUnitId: 'A', DirectValidatorId: 'mgr' },
    ]);
    const res = await service.findCollaborators('mgr');
    expect(res.map((r) => [r.Id, r.Links])).toEqual([
      ['e1', ['Entite', 'Pool']],
      ['e2', ['Direct']],
      ['e3', ['Pool']],
      ['e4', ['Entite', 'Direct', 'Pool']],
    ]);
    const where = prisma.employee.findMany.mock.calls[0][0].where;
    expect(where.Id).toEqual({ not: 'mgr' });
    expect(where.IsSystem).toBe(false);
    expect(where.IsDeleted).toBe(false);
    expect(where.OR).toEqual([
      { OrganizationUnitId: { in: ['A'] } },
      { OrganizationUnitId: { in: ['B', 'A'] } },
      { DirectValidatorId: 'mgr' },
    ]);
  });

  it("ne descend pas dans les sous-entites : une seule requete d'entites, filtree sur le manager", async () => {
    const { service, prisma } = build(['A'], [], []);
    await service.findCollaborators('mgr');
    expect(prisma.organizationUnit.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.organizationUnit.findMany.mock.calls[0][0].where).toEqual({ ManagerId: 'mgr', IsDeleted: false });
  });

  it("un pool de conges d'une entite en validation directe est ignore", async () => {
    const { service, prisma } = build([], [], []);
    await service.findCollaborators('mgr');
    expect(prisma.approvalPool.findMany.mock.calls[0][0].where.NOT).toEqual({
      ObjectType: 'Leave',
      organizationUnit: { LeaveApprovalMode: 'DirectValidator' },
    });
  });

  it('manager sans entite ni pool : seulement les rattaches directs', async () => {
    const { service, prisma } = build([], [], [{ Id: 'e2', OrganizationUnitId: 'Z', DirectValidatorId: 'mgr' }]);
    const res = await service.findCollaborators('mgr');
    expect(res[0].Links).toEqual(['Direct']);
    expect(prisma.employee.findMany.mock.calls[0][0].where.OR).toEqual([{ DirectValidatorId: 'mgr' }]);
  });
});

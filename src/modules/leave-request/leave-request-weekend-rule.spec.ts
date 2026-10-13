import { LeaveRequestService } from './leave-request.service';

// Retour client du 13/10 : "Off recuperation" ne doit pas compter le week-end. La
// regle du week-end avale (un vendredi absent compte le week-end suivant pour un
// employe local) se coupe par type : le type sans la regle est calcule comme pour
// un expatrie, a qui elle ne s'applique deja pas.
describe('LeaveRequestService.create : regle du week-end avale par type', () => {
  const local = { Id: 'e1', Gender: 'M', IsExpatriate: false, OrganizationUnitId: 'ou1', EmployeeCategoryId: null };
  const expat = { ...local, IsExpatriate: true };

  function build(employee: unknown, countWeekend: boolean | undefined) {
    const leaveType = {
      Id: 'lt',
      Name: 'Off recuperation',
      CountCalendarDays: false,
      AppliesToGender: null,
      AppliesToExpatriate: null,
      OrganizationUnitId: null,
      ...(countWeekend === undefined ? {} : { CountWeekendAfterFriday: countWeekend }),
    };
    const prisma = {
      employee: { findUnique: jest.fn().mockResolvedValue(employee) },
      leaveType: { findUnique: jest.fn().mockResolvedValue(leaveType) },
      leaveRequest: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ Id: 'req' }),
      },
    };
    const service = new LeaveRequestService(prisma as never, {} as never, {} as never, {} as never, {} as never);
    const compute = jest.fn().mockResolvedValue(1);
    (service as unknown as { computeWorkingDays: jest.Mock }).computeWorkingDays = compute;
    return { service, compute };
  }

  const dto = { LeaveTypeId: 'lt', StartDate: '2026-10-09', EndDate: '2026-10-09' };
  // 5e argument de computeWorkingDays = isExpatriate (vrai = regle non appliquee).
  const isExpatriateArg = (compute: jest.Mock) => compute.mock.calls[0][4];

  it('type avec la regle (defaut), employe local : la regle s\'applique', async () => {
    const { service, compute } = build(local, true);
    await service.create(dto as never, 'e1');
    expect(isExpatriateArg(compute)).toBe(false);
  });

  it('colonne absente ou non renseignee : meme comportement que la regle active', async () => {
    const { service, compute } = build(local, undefined);
    await service.create(dto as never, 'e1');
    // Seul un false explicite coupe la regle : jamais par accident.
    expect(isExpatriateArg(compute)).toBe(false);
  });

  it('type sans la regle, employe local : calcule comme un expatrie', async () => {
    const { service, compute } = build(local, false);
    await service.create(dto as never, 'e1');
    expect(isExpatriateArg(compute)).toBe(true);
  });

  it('employe expatrie : jamais de regle, quel que soit le type', async () => {
    const { service, compute } = build(expat, true);
    await service.create(dto as never, 'e1');
    expect(isExpatriateArg(compute)).toBe(true);
  });
});

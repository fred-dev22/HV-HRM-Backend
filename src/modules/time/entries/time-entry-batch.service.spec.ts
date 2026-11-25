import { BadRequestException, NotFoundException } from '@nestjs/common';
import { TimeEntryService } from './time-entry.service';

// Saisie en lot : meme circuit de validation que la saisie unitaire, mais une
// seule notification par destinataire, et rien n'est ecrit pendant un controle.
describe('TimeEntryService.createBatch', () => {
  const day = (key: string) => new Date(`${key}T00:00:00Z`);
  const employee = (id: string, validator: string | null = 'val') => ({
    Id: id, FullName: id.toUpperCase(), EmployeeNumber: id, Status: 'Active', HireDate: day('2020-01-01'),
    TerminationDate: null, OrganizationUnitId: 'unit', DirectValidatorId: validator,
  });

  beforeAll(() => jest.useFakeTimers({ now: new Date('2026-11-25T10:00:00Z') }));
  afterAll(() => jest.useRealTimers());

  function build(rows = [employee('a'), employee('b')]) {
    const created: Record<string, unknown>[] = [];
    const tx = {
      timeManualEntry: {
        create: jest.fn(async ({ data }) => { created.push(data); return { ...data, Id: `e${created.length}` }; }),
        update: jest.fn(async () => ({ EmployeeId: 'a', Date: day('2026-11-02'), Hours: 1, employee: { FullName: 'A' } })),
      },
      timeManualEntryHistory: { create: jest.fn() },
      approvalDecision: { create: jest.fn() },
    };
    const prisma = {
      employee: {
        findMany: jest.fn().mockResolvedValue(rows),
        findUniqueOrThrow: jest.fn(async ({ where }) => rows.find((r) => r.Id === where.Id)),
        findUnique: jest.fn().mockResolvedValue({ ValidatorInterimId: null }),
      },
      leaveRequest: { findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn().mockResolvedValue(null) },
      timeManualEntry: { findMany: jest.fn().mockResolvedValue([]), delete: jest.fn() },
      timeManualEntryHistory: { deleteMany: jest.fn() },
      $transaction: jest.fn(async (fn: (t: unknown) => unknown) => fn(tx)),
    };
    const notifications = { create: jest.fn() };
    const pools = { findApplicablePool: jest.fn().mockResolvedValue(null) };
    const calculation = { holidayKeysByEmployee: jest.fn().mockResolvedValue(new Map()) };
    const service = new TimeEntryService(prisma as never, pools as never, notifications as never, calculation as never);
    return { service, prisma, created, notifications };
  }

  const dto = (over: Record<string, unknown> = {}) => ({
    EmployeeIds: ['a', 'b'], From: '2026-11-02', To: '2026-11-04', Weekdays: [1, 2, 3], EntryType: 'panier' as const, ...over,
  });

  it('le controle ne cree rien et annonce le nombre de saisies', async () => {
    const { service, created, notifications } = build();
    const r = await service.createBatch(dto({ DryRun: true }), 'rh');
    expect(r).toMatchObject({ DryRun: true, Planned: 6, Created: 0 });
    expect(created).toHaveLength(0);
    expect(notifications.create).not.toHaveBeenCalled();
  });

  it('cree chaque journee et ne notifie le validateur qu une fois', async () => {
    const { service, created, notifications } = build();
    const r = await service.createBatch(dto(), 'rh');
    expect(r.Created).toBe(6);
    expect(created.every((c) => c.Hours === 1 && c.SubmittedById === 'rh')).toBe(true);
    expect(notifications.create).toHaveBeenCalledTimes(1);
    expect(notifications.create.mock.calls[0][0]).toMatchObject({ employeeId: 'val', message: expect.stringContaining('6 saisie(s)') });
  });

  it('panier : les horaires envoyes sont ignores', async () => {
    const { service, created } = build();
    await service.createBatch(dto({ StartTime: '08:00', EndTime: '17:00', Hours: 9 }), 'rh');
    expect(created[0]).toMatchObject({ Hours: 1, FirstClockIn: null, LastClockOut: null });
  });

  it('une mission demande une duree ou des horaires', async () => {
    const { service, created } = build();
    await expect(service.createBatch(dto({ EntryType: 'mission' }), 'rh')).rejects.toBeInstanceOf(BadRequestException);
    expect(created).toHaveLength(0);
  });

  it('un employe sans circuit est ecarte avec son motif, les autres passent', async () => {
    const { service } = build([employee('a'), employee('b', null)]);
    const r = await service.createBatch(dto(), 'rh');
    expect(r.Created).toBe(3);
    expect(r.Employees[1]).toMatchObject({ Planned: 0, Skipped: [{ Reason: 'Aucun circuit de validation' }] });
  });

  it('refuse un employe introuvable et une periode trop longue', async () => {
    const { service } = build([employee('a')]);
    await expect(service.createBatch(dto(), 'rh')).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.createBatch(dto({ From: '2026-11-01', To: '2027-02-01' }), 'rh')).rejects.toBeInstanceOf(BadRequestException);
  });
});

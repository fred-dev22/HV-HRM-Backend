import { OvertimeAlertService } from './overtime-alert.service';

const flush = () => new Promise((resolve) => setImmediate(resolve));

describe('envoi de l alerte heures supplementaires', () => {
  const employees: Record<string, { Id: string; Email: string | null }> = {
    chef: { Id: 'chef', Email: 'chef@exemple.com' },
    interim: { Id: 'interim', Email: 'interim@exemple.com' },
    rh: { Id: 'rh', Email: null },
    resp: { Id: 'resp', Email: 'resp@exemple.com' },
  };

  function build(options: { hours?: number; sent?: boolean; onLeave?: boolean; direct?: string | null } = {}) {
    const prisma = {
      timeOvertimeAlert: { findFirst: jest.fn().mockResolvedValue(options.sent ? { Id: 'x' } : null), create: jest.fn() },
      timeWeekHistory: { create: jest.fn() },
      leaveRequest: { findFirst: jest.fn().mockResolvedValue(options.onLeave ? { Id: 'l' } : null) },
      employee: {
        findUniqueOrThrow: jest.fn(async ({ select }) =>
          select.FullName
            ? { FullName: 'Mamy', EmployeeNumber: 'EMP005' }
            : {
                DirectValidatorId: options.direct === undefined ? 'chef' : options.direct,
                OrganizationUnitId: 'u',
                organizationUnit: { ManagerId: 'resp' },
                directValidator: { ValidatorInterimId: 'interim' },
              },
        ),
        findMany: jest.fn(async ({ where }) =>
          where.user ? [{ Id: 'rh' }, { Id: 'emp' }] : (where.Id.in as string[]).map((id) => employees[id]!),
        ),
      },
    };
    const calculation = {
      overtimeThresholds: jest.fn().mockResolvedValue({ alertHours: 20, legalHours: 20 }),
      monthlyOvertime: jest.fn().mockResolvedValue(new Map([['emp', options.hours ?? 22]])),
    };
    const pools = { findApplicablePool: jest.fn().mockResolvedValue({ members: [{ EmployeeId: 'chef', InterimEmployeeId: null }] }) };
    const notifications = { create: jest.fn() };
    const mail = { send: jest.fn().mockResolvedValue(true) };
    const service = new OvertimeAlertService(prisma as never, calculation as never, pools as never, notifications as never, mail as never);
    const notified = () => notifications.create.mock.calls.map((c) => c[0].employeeId).sort();
    return { service, prisma, calculation, pools, notifications, mail, notified };
  }

  it('previent le validateur, le responsable et la RH, jamais l employe lui-meme', async () => {
    const t = build();
    await t.service.notifyIfReached('emp', '2026-11-16', 'chef');
    await flush();
    expect(t.notified()).toEqual(['chef', 'resp', 'rh']);
    expect(t.notifications.create.mock.calls[0][0].message).toContain('22 h supplémentaires en novembre 2026');
    expect(t.mail.send.mock.calls.map((c) => c[0].to).sort()).toEqual(['chef@exemple.com', 'resp@exemple.com']);
    expect(t.prisma.timeOvertimeAlert.create.mock.calls[0][0].data).toMatchObject({ Month: '2026-11', Hours: 22, Threshold: 20 });
    expect(t.prisma.timeWeekHistory.create.mock.calls[0][0].data.Action).toBe('ALERT');
  });

  it("ajoute l'interimaire quand le validateur est en conge", async () => {
    const t = build({ onLeave: true });
    await t.service.notifyIfReached('emp', '2026-11-16', 'rh');
    expect(t.notified()).toContain('interim');
  });

  it('sans validateur direct, le pool de validation des temps est prevenu', async () => {
    const t = build({ direct: null });
    await t.service.notifyIfReached('emp', '2026-11-16', 'rh');
    expect(t.pools.findApplicablePool).toHaveBeenCalledWith('u', 'TimeEntry');
    expect(t.notified()).toContain('chef');
  });

  it('ne previent ni sous le seuil, ni deux fois le meme mois', async () => {
    for (const options of [{ hours: 19.5 }, { sent: true }]) {
      const t = build(options);
      await t.service.notifyIfReached('emp', '2026-11-16', 'chef');
      expect(t.notifications.create).not.toHaveBeenCalled();
    }
  });

  it('une semaine a cheval compte dans le mois de son dimanche', async () => {
    const t = build();
    await t.service.notifyIfReached('emp', '2026-11-30', 'chef');
    expect(t.calculation.monthlyOvertime).toHaveBeenCalledWith(['emp'], '2026-12');
  });

  it("un echec n'empeche pas le controle", async () => {
    const t = build();
    t.calculation.monthlyOvertime.mockRejectedValue(new Error('base indisponible'));
    await expect(t.service.notifyIfReached('emp', '2026-11-16', 'chef')).resolves.toBeUndefined();
  });
});

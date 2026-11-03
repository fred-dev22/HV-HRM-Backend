import { LeaveTransactionService } from './leave-transaction.service';

// Le cron et le bouton "Générer maintenant" peuvent partir au meme instant. Le
// controle "deja credite ce mois-ci" lit l'historique avant d'ecrire : sans
// execution en file, les deux passeraient le controle et crediteraient deux fois.
describe('LeaveTransactionService.generateAccruals : pas de double credit', () => {
  const employees = [
    { Id: 'e1', Gender: 'F', IsExpatriate: false, OrganizationUnitId: 'ou1' },
    { Id: 'e2', Gender: 'M', IsExpatriate: false, OrganizationUnitId: 'ou1' },
  ];
  const leaveType = {
    Id: 'annuel', DaysPerYear: 18, DaysPerMonth: null, MonthlyAccrual: true, AutoAccrual: true,
    AppliesToGender: null, AppliesToExpatriate: null, OrganizationUnitId: null,
  };

  function build() {
    const granted = new Set<string>();
    const prisma = {
      employee: { findMany: jest.fn().mockResolvedValue(employees) },
      leaveType: { findMany: jest.fn().mockResolvedValue([leaveType]) },
      leaveTransaction: {
        findFirst: jest.fn(async ({ where }: { where: { EmployeeId: string; LeaveTypeId: string } }) => {
          await new Promise((r) => setImmediate(r)); // lecture lente, comme une vraie base
          return granted.has(`${where.EmployeeId}:${where.LeaveTypeId}`) ? { Id: 'x' } : null;
        }),
      },
      companySettings: { updateMany: jest.fn() },
    };
    const service = new LeaveTransactionService(prisma as never, {} as never);
    const adjust = jest.spyOn(service, 'adjustBalance').mockImplementation(async (employeeId: string, leaveTypeId: string) => {
      await new Promise((r) => setImmediate(r)); // ecriture lente
      granted.add(`${employeeId}:${leaveTypeId}`);
      return {} as never;
    });
    return { service, adjust };
  }

  it('deux generations simultanees ne creditent chaque employe qu\'une fois', async () => {
    const { service, adjust } = build();
    const [a, b] = await Promise.all([service.generateAccruals('cron'), service.generateAccruals('bouton')]);
    expect(adjust).toHaveBeenCalledTimes(2);
    expect(a.created + b.created).toBe(2);
  });

  it('une generation qui echoue ne bloque pas les suivantes', async () => {
    const { service, adjust } = build();
    adjust.mockRejectedValueOnce(new Error('base indisponible'));
    await expect(service.generateAccruals('cron')).rejects.toThrow('base indisponible');
    await expect(service.generateAccruals('bouton')).resolves.toBeDefined();
  });
});

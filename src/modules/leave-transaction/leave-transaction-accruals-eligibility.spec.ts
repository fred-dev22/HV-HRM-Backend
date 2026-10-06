import { LeaveTransactionService } from './leave-transaction.service';

// La generation des acquisitions ne doit crediter un type qu'aux employes
// auxquels il s'applique (genre, expatrie, entite). Avant : tout le monde etait
// credite (ex : 98 jours de conge maternite a un homme), solde invisible a
// l'ecran car l'affichage filtre, mais present en base.
describe('LeaveTransactionService.generateAccruals : eligibilite', () => {
  const homme = { Id: 'h1', Gender: 'M', IsExpatriate: false, OrganizationUnitId: 'ou1' };
  const femme = { Id: 'f1', Gender: 'F', IsExpatriate: false, OrganizationUnitId: 'ou1' };
  const expatrie = { Id: 'x1', Gender: 'M', IsExpatriate: true, OrganizationUnitId: 'ou2' };

  const type = (over: Record<string, unknown>) => ({
    Id: 'lt',
    DaysPerYear: 10,
    DaysPerMonth: null,
    MonthlyAccrual: false,
    AppliesToGender: null,
    AppliesToExpatriate: null,
    OrganizationUnitId: null,
    ...over,
  });

  function build(employees: unknown[], leaveTypes: unknown[]) {
    const prisma = {
      employee: { findMany: jest.fn().mockResolvedValue(employees) },
      leaveType: { findMany: jest.fn().mockResolvedValue(leaveTypes) },
      leaveTransaction: { findFirst: jest.fn().mockResolvedValue(null) },
      companySettings: { updateMany: jest.fn() },
    };
    const service = new LeaveTransactionService(prisma as never, {} as never);
    const adjust = jest.spyOn(service, 'adjustBalance').mockResolvedValue({} as never);
    // [employe, type] credites
    const credited = () => adjust.mock.calls.map((c) => `${c[0]}:${c[1]}`);
    return { service, credited };
  }

  it('un type reserve aux femmes (annuel) n\'est credite qu\'aux femmes', async () => {
    const { service, credited } = build([homme, femme], [type({ Id: 'maternite', DaysPerYear: 98, AppliesToGender: 'F' })]);
    await service.generateAccruals('admin');
    expect(credited()).toEqual(['f1:maternite']);
  });

  it('un type reserve aux hommes (annuel) n\'est credite qu\'aux hommes', async () => {
    const { service, credited } = build([homme, femme], [type({ Id: 'paternite', DaysPerYear: 3, AppliesToGender: 'M' })]);
    await service.generateAccruals('admin');
    expect(credited()).toEqual(['h1:paternite']);
  });

  it('meme regle pour un type a accumulation mensuelle', async () => {
    const { service, credited } = build(
      [homme, femme],
      [type({ Id: 'allaitement', MonthlyAccrual: true, DaysPerMonth: 1, AppliesToGender: 'F' })],
    );
    await service.generateAccruals('admin');
    expect(credited()).toEqual(['f1:allaitement']);
  });

  it('un type sans ciblage est credite a tout le monde', async () => {
    const { service, credited } = build([homme, femme], [type({ Id: 'annuel', DaysPerYear: 30 })]);
    await service.generateAccruals('admin');
    expect(credited()).toEqual(['h1:annuel', 'f1:annuel']);
  });

  it('respecte aussi le ciblage expatrie et entite', async () => {
    const { service, credited } = build(
      [homme, femme, expatrie],
      [
        type({ Id: 'expat', AppliesToExpatriate: true }),
        type({ Id: 'entite2', OrganizationUnitId: 'ou2' }),
      ],
    );
    await service.generateAccruals('admin');
    expect(credited()).toEqual(['x1:expat', 'x1:entite2']);
  });

  it('un type a 0 jour par an n\'est jamais credite', async () => {
    const { service, credited } = build([homme, femme], [type({ Id: 'sans-solde', DaysPerYear: 0 })]);
    await service.generateAccruals('admin');
    expect(credited()).toEqual([]);
  });

  it('un employe seul (nouvel arrivant) ne recoit que les types qui le concernent', async () => {
    const { service, credited } = build(
      [femme],
      [type({ Id: 'paternite', DaysPerYear: 3, AppliesToGender: 'M' }), type({ Id: 'annuel', DaysPerYear: 30 })],
    );
    await service.generateAccruals('admin', { employeeId: 'f1' });
    expect(credited()).toEqual(['f1:annuel']);
  });
});

import { canDecide, directValidatorSpec, findApplicableStep, resolveApprovers, withOnBehalfOf } from './approver-resolution.util';

describe('resolveApprovers', () => {
  it('sans interimaire : le titulaire seul', () => {
    expect(resolveApprovers({ EmployeeId: 'T', InterimEmployeeId: null })).toEqual({ primary: 'T', all: ['T'] });
  });

  it('avec interimaire : titulaire et interimaire en meme temps, titulaire principal', () => {
    expect(resolveApprovers({ EmployeeId: 'T', InterimEmployeeId: 'I' })).toEqual({ primary: 'T', all: ['T', 'I'] });
  });

  it("un interimaire qui est le titulaire lui-meme n'ajoute personne", () => {
    expect(resolveApprovers({ EmployeeId: 'T', InterimEmployeeId: 'T' }).all).toEqual(['T']);
  });
});

describe('canDecide', () => {
  it("l'un ou l'autre peut decider, pas un tiers", () => {
    const resolved = { primary: 'T', all: ['T', 'I'] };
    expect(canDecide(resolved, 'T')).toBe(true);
    expect(canDecide(resolved, 'I')).toBe(true);
    expect(canDecide(resolved, 'X')).toBe(false);
  });
});

describe('findApplicableStep', () => {
  const members = [
    { StepOrder: 1, EmployeeId: 'N1', InterimEmployeeId: 'I1' },
    { StepOrder: 2, EmployeeId: 'N2', InterimEmployeeId: null },
  ];

  it('renvoie le premier niveau avec ses co-validateurs', () => {
    const r = findApplicableStep(members, 'EMP');
    expect(r?.member.StepOrder).toBe(1);
    expect(r?.approverId).toBe('N1');
    expect(r?.coApproverIds).toEqual(['I1']);
  });

  it('le demandeur est exclu des co-validateurs', () => {
    const r = findApplicableStep(members, 'I1');
    expect(r?.approverId).toBe('N1');
    expect(r?.coApproverIds).toEqual([]);
  });

  it('saute le niveau dont le validateur principal est le demandeur', () => {
    const r = findApplicableStep(members, 'N1');
    expect(r?.member.StepOrder).toBe(2);
    expect(r?.approverId).toBe('N2');
  });

  it('undefined quand tous les niveaux resolvent au demandeur', () => {
    expect(findApplicableStep([members[1]], 'N2')).toBeUndefined();
  });
});

describe('directValidatorSpec', () => {
  it("lit l'interimaire sur la fiche du validateur", async () => {
    const prisma = {
      employee: { findUnique: jest.fn(async ({ where }: { where: { Id: string } }) => (where.Id === 'V' ? { ValidatorInterimId: 'I' } : null)) },
    } as never;
    expect(await directValidatorSpec(prisma, 'V')).toEqual({ EmployeeId: 'V', InterimEmployeeId: 'I' });
    expect(await directValidatorSpec(prisma, 'X')).toEqual({ EmployeeId: 'X', InterimEmployeeId: null });
  });
});

describe('withOnBehalfOf', () => {
  const hery = { Id: 'hery', FullName: 'Hery' };
  const lalaina = { Id: 'lalaina', FullName: 'Lalaina' };

  it("signale l'etape decidee par l'interimaire", () => {
    const [d] = withOnBehalfOf([{ Decision: 'Approved', validatedByEmployee: lalaina, approvalPoolMember: { employee: hery } }]);
    expect(d.OnBehalfOf).toEqual(hery);
  });

  it('ne signale rien quand le validateur prevu decide lui-meme', () => {
    const [d] = withOnBehalfOf([{ Decision: 'Approved', validatedByEmployee: hery, approvalPoolMember: { employee: hery } }]);
    expect(d.OnBehalfOf).toBeNull();
  });

  it('ne signale rien tant que l etape est en attente', () => {
    const [d] = withOnBehalfOf([{ Decision: 'Pending', validatedByEmployee: hery, directValidatorEmployee: hery }]);
    expect(d.OnBehalfOf).toBeNull();
  });

  it('couvre le validateur direct', () => {
    const [d] = withOnBehalfOf([{ Decision: 'Rejected', validatedByEmployee: lalaina, directValidatorEmployee: hery }]);
    expect(d.OnBehalfOf).toEqual(hery);
  });
});

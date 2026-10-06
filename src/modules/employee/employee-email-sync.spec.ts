import { ConflictException } from '@nestjs/common';
import { EmployeeService } from './employee.service';

// Modifier l'email d'une fiche employe doit aussi modifier son compte de
// connexion (cas client : email corrige sur la fiche apres creation du compte,
// "Mot de passe oublie" ne trouvait plus rien et n'envoyait aucun mail).
describe('EmployeeService.update : synchronisation de l\'email du compte', () => {
  const existing = {
    Id: 'e1',
    FirstName: 'Ventso',
    LastName: 'RAHANDRISOA',
    Email: 'ancienne@galana.mg',
    UserId: 'u1',
    BirthDate: new Date('1990-01-01'),
    HireDate: new Date('2020-01-01'),
    PositionId: null,
  };

  function build(overrides: { taken?: boolean; usernameTaken?: boolean; username?: string; userId?: string | null } = {}) {
    const tx = {
      employee: { update: jest.fn().mockResolvedValue({ Id: 'e1' }) },
      user: {
        findFirst: jest.fn().mockImplementation(({ where }: { where: { Email?: string; Username?: string } }) => {
          if (where.Email) return Promise.resolve(overrides.taken ? { Id: 'autre' } : null);
          return Promise.resolve(overrides.usernameTaken ? { Id: 'autre' } : null);
        }),
        findUnique: jest.fn().mockResolvedValue({ Username: overrides.username ?? 'ancienne@galana.mg' }),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    const prisma = { $transaction: jest.fn((fn: (t: typeof tx) => unknown) => fn(tx)) };
    const service = new EmployeeService(prisma as never, {} as never, {} as never);
    jest
      .spyOn(service, 'findOne')
      .mockResolvedValue({ ...existing, UserId: overrides.userId === undefined ? 'u1' : overrides.userId } as never);
    return { service, tx };
  }

  it('met a jour l\'email et le nom d\'utilisateur du compte quand l\'email de la fiche change', async () => {
    const { service, tx } = build();
    await service.update('e1', { Email: 'nouvelle@galana.mg' } as never, 'admin');
    expect(tx.user.update).toHaveBeenCalledWith({
      where: { Id: 'u1' },
      data: expect.objectContaining({
        Email: 'nouvelle@galana.mg',
        Username: 'nouvelle@galana.mg',
        ResetPasswordTokenHash: null,
        ResetPasswordExpiresAt: null,
      }),
    });
    expect(tx.employee.update).toHaveBeenCalled();
  });

  it('ne touche pas au nom d\'utilisateur s\'il avait ete choisi a la main', async () => {
    const { service, tx } = build({ username: 'vrahandrisoa' });
    await service.update('e1', { Email: 'nouvelle@galana.mg' } as never, 'admin');
    const data = tx.user.update.mock.calls[0][0].data;
    expect(data.Email).toBe('nouvelle@galana.mg');
    expect(data).not.toHaveProperty('Username');
  });

  it('refuse si l\'adresse est deja utilisee par un autre compte, sans rien modifier', async () => {
    const { service, tx } = build({ taken: true });
    await expect(service.update('e1', { Email: 'prise@galana.mg' } as never, 'admin')).rejects.toBeInstanceOf(ConflictException);
    expect(tx.user.update).not.toHaveBeenCalled();
    expect(tx.employee.update).not.toHaveBeenCalled();
  });

  it('ne fait rien cote compte si l\'email ne change pas', async () => {
    const { service, tx } = build();
    await service.update('e1', { Email: 'ancienne@galana.mg', MobilePhone: '034' } as never, 'admin');
    expect(tx.user.update).not.toHaveBeenCalled();
  });

  it('ne fait rien cote compte si l\'email n\'est pas envoye', async () => {
    const { service, tx } = build();
    await service.update('e1', { MobilePhone: '034' } as never, 'admin');
    expect(tx.user.update).not.toHaveBeenCalled();
  });

  it('un employe sans compte : seule la fiche est modifiee', async () => {
    const { service, tx } = build({ userId: null });
    await service.update('e1', { Email: 'nouvelle@galana.mg' } as never, 'admin');
    expect(tx.user.update).not.toHaveBeenCalled();
    expect(tx.employee.update).toHaveBeenCalled();
  });
});

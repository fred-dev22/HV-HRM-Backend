import { ConflictException } from '@nestjs/common';
import { UserService } from './user.service';

// L'email du compte est toujours celui de la fiche employe, jamais celui
// envoye par le client.
describe('UserService.create : email du compte', () => {
  function build(opts: { emailTaken?: boolean } = {}) {
    const createdUser = { Id: 'u1', Email: 'fiche@galana.mg', Username: 'fiche@galana.mg' };
    const tx = {
      user: { create: jest.fn().mockResolvedValue(createdUser) },
      userPermission: { createMany: jest.fn() },
      employee: { update: jest.fn() },
    };
    const prisma = {
      employee: { findUnique: jest.fn().mockResolvedValue({ Id: 'e1', FirstName: 'Ventso', Email: 'fiche@galana.mg', UserId: null }) },
      employeeCategory: { findUnique: jest.fn().mockResolvedValue({ Id: 'c1', categoryPermissions: [] }) },
      user: { findUnique: jest.fn().mockResolvedValue(opts.emailTaken ? { Id: 'autre' } : null) },
      $transaction: jest.fn((fn: (t: typeof tx) => unknown) => fn(tx)),
    };
    const mail = { send: jest.fn().mockResolvedValue(true) };
    return { service: new UserService(prisma as never, mail as never), tx, mail };
  }

  const dto = {
    Username: 'fiche@galana.mg',
    Email: 'faute-de-frappe@galana.mg',
    Password: 'Motdepasse1!',
    EmployeeId: 'e1',
    EmployeeCategoryId: 'c1',
  };

  it('utilise l\'email de la fiche meme si le client en envoie un autre', async () => {
    const { service, tx, mail } = build();
    await service.create(dto as never);
    expect(tx.user.create.mock.calls[0][0].data.Email).toBe('fiche@galana.mg');
    expect(mail.send.mock.calls[0][0].to).toBe('fiche@galana.mg');
  });

  it('refuse clairement si un autre compte utilise deja cette adresse', async () => {
    const { service, tx } = build({ emailTaken: true });
    await expect(service.create(dto as never)).rejects.toBeInstanceOf(ConflictException);
    expect(tx.user.create).not.toHaveBeenCalled();
  });
});

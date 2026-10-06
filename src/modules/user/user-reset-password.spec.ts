import * as bcrypt from 'bcryptjs';
import { BadRequestException, Logger, NotFoundException } from '@nestjs/common';
import { UserService } from './user.service';
import { generateTemporaryPassword } from '../../common/utils/temporary-password.util';

describe('generateTemporaryPassword', () => {
  it('12 caracteres avec majuscule, minuscule, chiffre et symbole, sans caracteres ambigus', () => {
    for (let i = 0; i < 200; i++) {
      const pwd = generateTemporaryPassword();
      expect(pwd).toHaveLength(12);
      expect(pwd).toMatch(/[A-Z]/);
      expect(pwd).toMatch(/[a-z]/);
      expect(pwd).toMatch(/[0-9]/);
      expect(pwd).toMatch(/[@#$%!?]/);
      expect(pwd).not.toMatch(/[0OIl1]/);
    }
  });

  it('ne se repete pas', () => {
    const set = new Set(Array.from({ length: 200 }, () => generateTemporaryPassword()));
    expect(set.size).toBe(200);
  });
});

describe('UserService.resetPasswordByAdmin', () => {
  function build(user: unknown) {
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue(user),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    const mail = { send: jest.fn() };
    return { service: new UserService(prisma as never, mail as never), prisma, mail };
  }
  const account = { Id: 'u1', Email: 'hery@galana.mg', employee: { IsSystem: false } };

  afterEach(() => jest.restoreAllMocks());

  it('genere un mot de passe temporaire, le hache, impose son changement et invalide les liens en cours', async () => {
    const { service, prisma, mail } = build(account);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const res = await service.resetPasswordByAdmin('u1', 'admin-user');
    expect(res.email).toBe('hery@galana.mg');
    expect(res.temporaryPassword).toHaveLength(12);

    const data = prisma.user.update.mock.calls[0][0].data;
    expect(data.MustChangePassword).toBe(true);
    expect(data.ResetPasswordTokenHash).toBeNull();
    expect(data.ResetPasswordExpiresAt).toBeNull();
    // le mot de passe n'est jamais stocke en clair
    expect(data.PasswordHash).not.toBe(res.temporaryPassword);
    expect(await bcrypt.compare(res.temporaryPassword, data.PasswordHash)).toBe(true);
    // et jamais envoye par email
    expect(mail.send).not.toHaveBeenCalled();
  });

  it('n\'ecrit jamais le mot de passe dans les journaux', async () => {
    const { service } = build(account);
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const res = await service.resetPasswordByAdmin('u1', 'admin-user');
    expect(log).toHaveBeenCalledTimes(1);
    expect(String(log.mock.calls[0][0])).not.toContain(res.temporaryPassword);
  });

  it('refuse pour son propre compte', async () => {
    const { service, prisma } = build(account);
    await expect(service.resetPasswordByAdmin('u1', 'u1')).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('refuse pour le compte administrateur systeme', async () => {
    const { service, prisma } = build({ ...account, employee: { IsSystem: true } });
    await expect(service.resetPasswordByAdmin('u1', 'admin-user')).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('compte introuvable', async () => {
    const { service } = build(null);
    await expect(service.resetPasswordByAdmin('x', 'admin-user')).rejects.toBeInstanceOf(NotFoundException);
  });
});

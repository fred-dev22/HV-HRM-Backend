import { Logger } from '@nestjs/common';
import { AuthService } from './auth.service';

describe('AuthService.forgotPassword', () => {
  function build(user: unknown) {
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue(user),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    const mail = { send: jest.fn().mockResolvedValue(true) };
    const service = new AuthService(prisma as never, {} as never, mail as never);
    return { service, prisma, mail };
  }

  afterEach(() => jest.restoreAllMocks());

  it('cherche l\'email sans espaces autour', async () => {
    const { service, prisma } = build(null);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    await service.forgotPassword({ email: '  ventso@galana.mg ' } as never);
    expect(prisma.user.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { Email: 'ventso@galana.mg' } }));
  });

  it('aucun compte : meme reponse, aucun mail, mais la raison est journalisee', async () => {
    const { service, mail } = build(null);
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const res = await service.forgotPassword({ email: 'inconnu@galana.mg' } as never);
    expect(res.message).toContain('Si un compte existe');
    expect(mail.send).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('aucun compte'));
  });

  it('compte desactive : meme reponse, aucun mail, raison journalisee', async () => {
    const { service, mail } = build({ Id: 'u1', Email: 'a@galana.mg', IsActive: false, employee: null });
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    await service.forgotPassword({ email: 'a@galana.mg' } as never);
    expect(mail.send).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('desactive'));
  });

  it('compte actif : un mail part a l\'adresse du compte', async () => {
    const { service, mail } = build({ Id: 'u1', Email: 'a@galana.mg', Username: 'a', IsActive: true, employee: { IsDeleted: false, Status: 'Active' } });
    await service.forgotPassword({ email: 'a@galana.mg' } as never);
    expect(mail.send).toHaveBeenCalledWith(expect.objectContaining({ to: 'a@galana.mg' }));
  });
});

import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { SystemAdminGuard, isSystemAdminUser } from './system-admin.guard';

const ctx = (user: any) => ({ switchToHttp: () => ({ getRequest: () => ({ user }) }) }) as any;
const prismaWith = (row: any) => ({ user: { findFirst: jest.fn().mockResolvedValue(row) } }) as any;
const admin = { IsActive: true, employee: { IsSystem: true, IsDeleted: false, Status: 'Active' } };

describe('SystemAdminGuard : compte administrateur de lancement uniquement', () => {
  it("laisse passer le compte d'amorcage actif", async () => {
    await expect(new SystemAdminGuard(prismaWith(admin)).canActivate(ctx({ sub: 'u1' }))).resolves.toBe(true);
  });

  it('refuse un employe ordinaire, meme avec toutes les permissions', async () => {
    const guard = new SystemAdminGuard(prismaWith({ ...admin, employee: { ...admin.employee, IsSystem: false } }));
    await expect(guard.canActivate(ctx({ sub: 'u2' }))).rejects.toThrow(ForbiddenException);
  });

  it("refuse le compte d'amorcage desactive, supprime, ou inactif", async () => {
    for (const row of [
      { ...admin, IsActive: false },
      { ...admin, employee: { ...admin.employee, IsDeleted: true } },
      { ...admin, employee: { ...admin.employee, Status: 'Inactive' } },
      { IsActive: true, employee: null },
      null,
    ]) {
      expect(await isSystemAdminUser(prismaWith(row), 'u1')).toBe(false);
    }
  });

  it('refuse une requete sans utilisateur authentifie', async () => {
    await expect(new SystemAdminGuard(prismaWith(admin)).canActivate(ctx(undefined))).rejects.toThrow(UnauthorizedException);
  });
});

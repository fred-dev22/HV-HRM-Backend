import { ForbiddenException } from '@nestjs/common';
import { assertMayCreateFor } from './act-for-other.util';

describe('assertMayCreateFor', () => {
  const prismaWith = (requesterEntity: string | null) => ({
    employee: { findUnique: jest.fn().mockResolvedValue(requesterEntity === undefined ? null : { OrganizationUnitId: requesterEntity }) },
  });
  const target = (entity: string | null) => ({ Id: 'cible', OrganizationUnitId: entity });

  it('pour soi-meme : toujours permis, sans requete', async () => {
    const prisma = prismaWith('A');
    await expect(assertMayCreateFor(prisma, { Id: 'moi', OrganizationUnitId: 'A' }, 'moi', false)).resolves.toBeUndefined();
    expect(prisma.employee.findUnique).not.toHaveBeenCalled();
  });

  it('avec la permission : permis pour une autre entite, sans requete', async () => {
    const prisma = prismaWith('A');
    await expect(assertMayCreateFor(prisma, target('B'), 'moi', true)).resolves.toBeUndefined();
    expect(prisma.employee.findUnique).not.toHaveBeenCalled();
  });

  it('sans permission : permis pour un employe de la meme entite', async () => {
    await expect(assertMayCreateFor(prismaWith('A'), target('A'), 'moi', false)).resolves.toBeUndefined();
  });

  it('sans permission : refuse pour une autre entite', async () => {
    await expect(assertMayCreateFor(prismaWith('A'), target('B'), 'moi', false)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('sans permission : refuse quand le demandeur n\'a pas d\'entite', async () => {
    await expect(assertMayCreateFor(prismaWith(null), target(null), 'moi', false)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('sans permission : refuse quand le demandeur est introuvable', async () => {
    const prisma = { employee: { findUnique: jest.fn().mockResolvedValue(null) } };
    await expect(assertMayCreateFor(prisma, target('A'), 'moi', false)).rejects.toBeInstanceOf(ForbiddenException);
  });
});

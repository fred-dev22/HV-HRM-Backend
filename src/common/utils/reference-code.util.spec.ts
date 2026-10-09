import { Prisma } from '../../../prisma/generated/client';
import { nextReferenceCode, retryOnReferenceCodeConflict } from './reference-code.util';

describe('nextReferenceCode', () => {
  const prefix = 'DMD-2026-';

  it('commence a 1 quand rien n existe', () => {
    expect(nextReferenceCode(prefix, null)).toBe('DMD-2026-00001');
    expect(nextReferenceCode(prefix, undefined)).toBe('DMD-2026-00001');
  });

  it('suit le plus grand numero, pas le nombre de lignes (trou apres suppression)', () => {
    // 1..10 existent, le 3 a ete supprime : il reste 9 lignes. L'ancien calcul
    // (nombre + 1) redonnait 00010, deja pris.
    expect(nextReferenceCode(prefix, 'DMD-2026-00010')).toBe('DMD-2026-00011');
  });

  it('ignore un dernier code d une autre serie', () => {
    expect(nextReferenceCode(prefix, 'DMD-2025-00042')).toBe('DMD-2026-00001');
  });
});

describe('retryOnReferenceCodeConflict', () => {
  const conflict = () => new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: 'test' });

  it('rejoue la creation apres un conflit de numero', async () => {
    const create = jest.fn().mockRejectedValueOnce(conflict()).mockResolvedValueOnce('ok');
    await expect(retryOnReferenceCodeConflict(create)).resolves.toBe('ok');
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('abandonne apres plusieurs conflits consecutifs', async () => {
    const create = jest.fn().mockRejectedValue(conflict());
    await expect(retryOnReferenceCodeConflict(create)).rejects.toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
    expect(create).toHaveBeenCalledTimes(5);
  });

  it('ne rejoue pas une autre erreur', async () => {
    const create = jest.fn().mockRejectedValue(new Error('autre'));
    await expect(retryOnReferenceCodeConflict(create)).rejects.toThrow('autre');
    expect(create).toHaveBeenCalledTimes(1);
  });
});

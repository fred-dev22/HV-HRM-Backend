import { BadRequestException } from '@nestjs/common';
import { LeaveRequestService } from './leave-request.service';

// Retour client : DMD-2026-00250 (conge annuel du 23/11 au 27/11 matin) puis
// DMD-2026-00251 (recuperation le 27/11 apres-midi) etait refusee comme
// "chevauchement". Le controle se fait maintenant a la demi-journee.
const d = (s: string) => new Date(`${s}T00:00:00.000Z`);

const REQUEST_250 = {
  ReferenceCode: 'DMD-2026-00250',
  StartDate: d('2026-11-23'),
  StartPeriod: 'am',
  EndDate: d('2026-11-27'),
  EndPeriod: 'am',
};

function build(existing: unknown[]) {
  const findMany = jest.fn().mockResolvedValue(existing);
  const prisma = { leaveRequest: { findMany } };
  const service = new LeaveRequestService(prisma as any, {} as any, {} as any, {} as any, {} as any);
  const check = (start: string, sp: string, end: string, ep: string) =>
    (service as any).assertNoOverlap('emp', d(start), d(end), 'req-251', undefined, { startPeriod: sp, endPeriod: ep });
  return { check, findMany };
}

describe('LeaveRequestService.assertNoOverlap : au demi-jour', () => {
  it('accepte la recuperation du vendredi apres-midi apres un conge fini vendredi matin', async () => {
    const { check } = build([REQUEST_250]);
    await expect(check('2026-11-27', 'pm', '2026-11-27', 'full')).resolves.toBeUndefined();
  });

  it('refuse la recuperation du vendredi matin (meme creneau que la fin du conge)', async () => {
    const { check } = build([REQUEST_250]);
    await expect(check('2026-11-27', 'am', '2026-11-27', 'am')).rejects.toThrow(BadRequestException);
    await expect(check('2026-11-27', 'am', '2026-11-27', 'am')).rejects.toThrow(/DMD-2026-00250/);
  });

  it('refuse une journee entiere le vendredi (le matin est deja pris)', async () => {
    const { check } = build([REQUEST_250]);
    await expect(check('2026-11-27', 'am', '2026-11-27', 'full')).rejects.toThrow(/chevauche/);
  });

  it('refuse quand le conge existant couvre toute la journee du vendredi', async () => {
    const { check } = build([{ ...REQUEST_250, EndPeriod: 'full' }]);
    await expect(check('2026-11-27', 'pm', '2026-11-27', 'full')).rejects.toThrow(/DMD-2026-00250/);
  });

  it('la requete de pre-filtrage reste bornee par les dates', async () => {
    const { check, findMany } = build([]);
    await check('2026-11-27', 'pm', '2026-11-27', 'full');
    const where = findMany.mock.calls[0][0].where;
    expect(where.EmployeeId).toBe('emp');
    expect(where.Id).toEqual({ not: 'req-251' });
    expect(where.IsDeleted).toBe(false);
  });

  it('utilise le message personnalise (interimaire) quand il y a un vrai chevauchement', async () => {
    const { findMany } = build([REQUEST_250]);
    const service = new LeaveRequestService({ leaveRequest: { findMany } } as any, {} as any, {} as any, {} as any, {} as any);
    await expect(
      (service as any).assertNoOverlap('interim', d('2026-11-24'), d('2026-11-24'), undefined, (c: string) => `interim absent (${c})`, {
        startPeriod: 'am',
        endPeriod: 'full',
      }),
    ).rejects.toThrow('interim absent (DMD-2026-00250)');
  });
});

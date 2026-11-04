import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { TimeEntryService, describeAdjustment } from './time-entry.service';

describe('describeAdjustment', () => {
  it('garde l\'ancienne et la nouvelle duree, la plage et le motif', () => {
    expect(describeAdjustment(1, 3, '08:00', '11:00', 'Réunion prolongée')).toBe('Durée 1 h → 3 h (08:00 à 11:00) : Réunion prolongée');
  });
  it('sans plage ni motif, et avec des heures decimales', () => {
    expect(describeAdjustment(1.5, 2)).toBe('Durée 1,5 h → 2 h');
  });
});

// Le validateur courant peut ajuster les heures d'une saisie en attente ; la
// saisie reste en attente (elle ne repart pas au debut du circuit).
describe('TimeEntryService.adjust', () => {
  const entry = (over: Record<string, unknown> = {}) => ({
    Id: 'e1', EmployeeId: 'emp', Status: 'Pending', CurrentApprovalStep: 1, EntryType: 'mission',
    Date: new Date('2026-11-03T00:00:00Z'), Hours: 1, FirstClockIn: null, LastClockOut: null,
    employee: { Id: 'emp', FullName: 'Alice', EmployeeNumber: 'P001' }, ...over,
  });

  function build(entryRow: unknown, validatorId = 'val') {
    const history = jest.fn();
    const update = jest.fn().mockResolvedValue({ Id: 'e1' });
    const prisma = {
      timeManualEntry: { findUnique: jest.fn().mockResolvedValue(entryRow), update },
      approvalDecision: { findFirst: jest.fn().mockResolvedValue({ ValidatedByEmployeeId: validatorId }) },
      timeManualEntryHistory: { create: history },
      $transaction: jest.fn(async (fn: (tx: unknown) => unknown) => fn({ timeManualEntry: { update }, timeManualEntryHistory: { create: history } })),
    };
    const notifications = { create: jest.fn() };
    const service = new TimeEntryService(prisma as never, {} as never, notifications as never);
    return { service, history, update, notifications };
  }

  it('le validateur courant ajuste : duree changee, statut inchange, historique ADJUST', async () => {
    const { service, history, update, notifications } = build(entry());
    await service.adjust('e1', { Hours: 3, Comment: 'Réunion prolongée' }, 'val', new Set(['TEMPS_VALIDER']));
    expect(update.mock.calls[0][0].data.Hours).toBe(3);
    expect(update.mock.calls[0][0].data.Status).toBeUndefined();
    expect(update.mock.calls[0][0].data.CurrentApprovalStep).toBeUndefined();
    expect(history.mock.calls[0][0].data).toMatchObject({ Action: 'ADJUST', ActorId: 'val', EntryId: 'e1' });
    expect(history.mock.calls[0][0].data.Comment).toContain('1 h → 3 h');
    expect(notifications.create).toHaveBeenCalled();
  });

  it('un autre que le validateur courant est refuse', async () => {
    const { service, update } = build(entry(), 'autre');
    await expect(service.adjust('e1', { Hours: 3 }, 'val', new Set(['TEMPS_VALIDER']))).rejects.toBeInstanceOf(ForbiddenException);
    expect(update).not.toHaveBeenCalled();
  });

  it('une saisie deja decidee ne s\'ajuste plus', async () => {
    const { service } = build(entry({ Status: 'Approved' }));
    await expect(service.adjust('e1', { Hours: 3 }, 'val', new Set(['TEMPS_VALIDER']))).rejects.toBeInstanceOf(BadRequestException);
  });

  it('panier et permanence n\'ont pas d\'heures a ajuster', async () => {
    const { service } = build(entry({ EntryType: 'panier' }));
    await expect(service.adjust('e1', { Hours: 3 }, 'val', new Set(['TEMPS_VALIDER']))).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuse un ajustement qui ne change rien', async () => {
    const { service } = build(entry());
    await expect(service.adjust('e1', { Hours: 1 }, 'val', new Set(['TEMPS_VALIDER']))).rejects.toBeInstanceOf(BadRequestException);
  });

  it('le RH peut ajuster meme sans etre le validateur courant', async () => {
    const { service, update } = build(entry(), 'autre');
    await service.adjust('e1', { Hours: 2 }, 'rh', new Set(['TEMPS_ACCES']));
    expect(update).toHaveBeenCalled();
  });
});

import { BadRequestException } from '@nestjs/common';
import { LeaveRequestService } from './leave-request.service';

// Verrouille la re-decision d'un element deja annule/decide (ex. ancien
// bouton Approuver d'un email envoye avant l'annulation).
describe('LeaveRequestService : annulation et re-decision', () => {
  const ID = 'e-1';
  const EMP = 'emp-1';

  function build(status: string) {
    const tx = {
      approvalDecision: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      leaveRequest: { update: jest.fn().mockResolvedValue({ Id: ID, Status: 'Cancelled' }) },
    };
    const prisma = {
      approvalDecision: { findFirst: jest.fn(), update: jest.fn() },
      approvalPoolMember: { findFirst: jest.fn() },
      approvalPool: { findUniqueOrThrow: jest.fn() },
      leaveRequest: { update: jest.fn() },
      $transaction: jest.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
    };
    const notifier = {
      notifyCancelled: jest.fn(), notifyApproved: jest.fn(), notifyRejected: jest.fn(),
      notifyReturned: jest.fn(), notifyProgressed: jest.fn(),
    };
    const service = new LeaveRequestService(prisma as any, {} as any, { adjustBalance: jest.fn() } as any, notifier as any, {} as any);
    jest.spyOn(service as any, 'findOneRaw').mockResolvedValue({
      Id: ID, EmployeeId: EMP, CreatedBy: EMP, Status: status,
      ApprovalPoolId: 'pool-1', CurrentApprovalStep: 1, LeaveTypeId: 'lt-1', DaysCount: 2,
      StartDate: new Date('2026-10-01'), EndDate: new Date('2026-10-02'),
      DepartureDate: new Date('2026-10-01'), ReturnDate: new Date('2026-10-02'),
    });
    return { service, prisma, tx, notifier };
  }

  it('cancel() cloture la decision Pending et remet CurrentApprovalStep a null', async () => {
    const { service, tx } = build('InApprovalN1');
    await service.cancel(ID, EMP, false);
    expect(tx.approvalDecision.updateMany).toHaveBeenCalledWith({
      where: { EntityType: 'LeaveRequest', EntityId: ID, Decision: 'Pending' },
      data: expect.objectContaining({ Decision: 'Cancelled' }),
    });
    expect(tx.leaveRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ Status: 'Cancelled', CurrentApprovalStep: null }),
      }),
    );
  });

  it.each(['approve', 'reject', 'return_'] as const)(
    '%s() refuse un element deja annule, meme avec canOverride, sans aucune ecriture',
    async (method) => {
      const { service, prisma, notifier } = build('Cancelled');
      await expect(service[method](ID, { Comment: 'ok' } as any, 'validator', true)).rejects.toThrow(
        BadRequestException,
      );
      await expect(service[method](ID, { Comment: 'ok' } as any, 'validator', true)).rejects.toThrow(
        /n'est plus en attente de validation/,
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(prisma.approvalDecision.update).not.toHaveBeenCalled();
      expect(notifier.notifyApproved).not.toHaveBeenCalled();
    },
  );

  it.each(['Approved', 'Rejected', 'Returned', 'Draft'])(
    'approve() refuse le statut %s',
    async (status) => {
      const { service } = build(status);
      await expect(service.approve(ID, {} as any, 'validator', true)).rejects.toThrow(BadRequestException);
    },
  );
});

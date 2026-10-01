import { BadRequestException } from '@nestjs/common';
import { LeaveRequestService } from './leave-request.service';

// Regle "justificatif obligatoire" (retour client du 28/09) : bloquante a la
// soumission pour un type standard, a la regularisation pour un type medical.
// Les dependances sont remplacees par des doubles minimaux ; assertNoOverlap
// (premiere etape apres la verification du justificatif) sert de sentinelle
// pour prouver que la soumission est allee plus loin.
const REACHED_OVERLAP = new Error('SENTINELLE_OVERLAP');

function build(opts: {
  documentRequired: boolean;
  workflowType: 'Standard' | 'Medical';
  attachments: number;
  status?: string;
}) {
  const prisma = {
    employee: { findUniqueOrThrow: jest.fn().mockResolvedValue({ Id: 'emp' }) },
    leaveType: {
      findUniqueOrThrow: jest.fn().mockResolvedValue({
        Id: 'type',
        DocumentRequired: opts.documentRequired,
        WorkflowType: opts.workflowType,
      }),
    },
    attachment: { count: jest.fn().mockResolvedValue(opts.attachments) },
    leaveRequest: {
      findUnique: jest.fn().mockResolvedValue({
        Id: 'req',
        EmployeeId: 'emp',
        CreatedBy: 'emp',
        LeaveTypeId: 'type',
        Status: opts.status ?? 'Draft',
        IsDeleted: false,
        StartDate: new Date('2026-10-01T00:00:00Z'),
        EndDate: new Date('2026-10-02T00:00:00Z'),
        leaveType: { DocumentRequired: opts.documentRequired, WorkflowType: opts.workflowType },
      }),
      update: jest.fn().mockResolvedValue({ Id: 'req', Status: 'Regularized' }),
    },
  };
  const notifier = { notifyRegularized: jest.fn() };
  const service = new LeaveRequestService(
    prisma as any,
    {} as any,
    { getBalance: jest.fn().mockResolvedValue(10) } as any,
    notifier as any,
    {} as any,
  );
  (service as any).assertNoOverlap = jest.fn().mockRejectedValue(REACHED_OVERLAP);
  (service as any).toContext = jest.fn().mockResolvedValue({});
  return { service, prisma, notifier };
}

describe('LeaveRequestService : justificatif obligatoire', () => {
  describe('submit()', () => {
    it('bloque un type standard exigeant un justificatif quand aucune piece jointe', async () => {
      const { service, prisma } = build({ documentRequired: true, workflowType: 'Standard', attachments: 0 });
      await expect(service.submit('req', 'emp', false)).rejects.toThrow(BadRequestException);
      await expect(service.submit('req', 'emp', false)).rejects.toThrow(/justificatif est obligatoire/);
      // Le comptage doit viser les pieces jointes de CETTE demande, pas d'une autre entite.
      expect(prisma.attachment.count).toHaveBeenCalledWith({
        where: { EntityType: 'LeaveRequest', EntityId: 'req' },
      });
    });

    it('laisse passer quand une piece jointe est presente', async () => {
      const { service } = build({ documentRequired: true, workflowType: 'Standard', attachments: 1 });
      await expect(service.submit('req', 'emp', false)).rejects.toBe(REACHED_OVERLAP);
    });

    it("n'impose rien quand le type ne l'exige pas (piece jointe facultative)", async () => {
      const { service, prisma } = build({ documentRequired: false, workflowType: 'Standard', attachments: 0 });
      await expect(service.submit('req', 'emp', false)).rejects.toBe(REACHED_OVERLAP);
      expect(prisma.attachment.count).not.toHaveBeenCalled();
    });

    it('ne bloque pas un type medical a la soumission (declaration a posteriori)', async () => {
      const { service, prisma } = build({ documentRequired: true, workflowType: 'Medical', attachments: 0 });
      await expect(service.submit('req', 'emp', false)).rejects.toBe(REACHED_OVERLAP);
      expect(prisma.attachment.count).not.toHaveBeenCalled();
    });

    it('bloque aussi le renvoi d une demande retournee', async () => {
      const { service } = build({ documentRequired: true, workflowType: 'Standard', attachments: 0, status: 'Returned' });
      await expect(service.submit('req', 'emp', false)).rejects.toThrow(/justificatif est obligatoire/);
    });
  });

  describe('remove() : suppression d un brouillon', () => {
    function buildRemove(status: string) {
      const tx = {
        attachment: { deleteMany: jest.fn().mockResolvedValue({ count: 1 }) },
        leaveRequest: { delete: jest.fn().mockResolvedValue({ Id: 'req', Status: 'Draft' }) },
      };
      const { service, prisma } = build({ documentRequired: true, workflowType: 'Standard', attachments: 1, status });
      (prisma as any).$transaction = jest.fn(async (fn: (t: typeof tx) => unknown) => fn(tx));
      return { service, prisma, tx };
    }

    it('supprime aussi les pieces jointes du brouillon, dans la meme transaction', async () => {
      const { service, prisma, tx } = buildRemove('Draft');
      await service.remove('req', 'emp', false);
      expect((prisma as any).$transaction).toHaveBeenCalledTimes(1);
      expect(tx.attachment.deleteMany).toHaveBeenCalledWith({ where: { EntityType: 'LeaveRequest', EntityId: 'req' } });
      expect(tx.leaveRequest.delete).toHaveBeenCalledWith({ where: { Id: 'req' } });
    });

    it('refuse de supprimer une demande deja soumise, sans toucher aux pieces jointes', async () => {
      const { service, prisma, tx } = buildRemove('Pending');
      await expect(service.remove('req', 'emp', false)).rejects.toThrow(BadRequestException);
      expect((prisma as any).$transaction).not.toHaveBeenCalled();
      expect(tx.attachment.deleteMany).not.toHaveBeenCalled();
    });
  });

  describe('regularize()', () => {
    it('bloque la regularisation medicale sans justificatif', async () => {
      const { service, prisma } = build({
        documentRequired: true, workflowType: 'Medical', attachments: 0, status: 'Done',
      });
      await expect(service.regularize('req', 'emp')).rejects.toThrow(/justificatif est obligatoire pour régulariser/);
      expect(prisma.leaveRequest.update).not.toHaveBeenCalled();
    });

    it('autorise la regularisation quand le justificatif est fourni', async () => {
      const { service, prisma, notifier } = build({
        documentRequired: true, workflowType: 'Medical', attachments: 1, status: 'Done',
      });
      await service.regularize('req', 'emp');
      expect(prisma.leaveRequest.update).toHaveBeenCalled();
      expect(notifier.notifyRegularized).toHaveBeenCalled();
    });

    it("n'exige rien quand le type medical ne demande pas de justificatif", async () => {
      const { service, prisma } = build({
        documentRequired: false, workflowType: 'Medical', attachments: 0, status: 'Done',
      });
      await service.regularize('req', 'emp');
      expect(prisma.attachment.count).not.toHaveBeenCalled();
      expect(prisma.leaveRequest.update).toHaveBeenCalled();
    });
  });
});

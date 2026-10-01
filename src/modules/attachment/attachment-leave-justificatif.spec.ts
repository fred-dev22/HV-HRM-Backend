import { ForbiddenException } from '@nestjs/common';
import { AttachmentService } from './attachment.service';

// Garde-fous du justificatif de demande de conge (retour client du 28/09) :
// le createur (saisie pour un tiers) peut joindre le document, et un
// justificatif obligatoire ne peut plus etre retire une fois la demande
// soumise (sinon la regle serait contournable).
function build(leave: {
  Status: string;
  documentRequired: boolean;
  workflowType?: 'Standard' | 'Medical';
} | null) {
  const attachment = { Id: 'att', EntityType: 'LeaveRequest', EntityId: 'req', CreatedBy: 'user' };
  const prisma = {
    attachment: {
      findUnique: jest.fn().mockResolvedValue(attachment),
      delete: jest.fn().mockResolvedValue(attachment),
      create: jest.fn().mockResolvedValue({ Id: 'new' }),
      findMany: jest.fn().mockResolvedValue([]),
    },
    leaveRequest: {
      findUnique: jest.fn().mockImplementation(({ select }: { select: Record<string, unknown> }) => {
        if (!leave) return Promise.resolve(null);
        // Meme requete pour la garde de suppression (Status + leaveType) et
        // pour le controle d'acces (EmployeeId + CreatedBy).
        if ('EmployeeId' in select) return Promise.resolve({ EmployeeId: 'beneficiary', CreatedBy: 'creator' });
        return Promise.resolve({
          Status: leave.Status,
          leaveType: { DocumentRequired: leave.documentRequired, WorkflowType: leave.workflowType ?? 'Standard' },
        });
      }),
    },
  };
  const sharePoint = { uploadFile: jest.fn().mockResolvedValue({ url: 'https://sp/x', size: 10 }) };
  return { service: new AttachmentService(prisma as any, sharePoint as any), prisma, sharePoint };
}

describe('AttachmentService : justificatif de demande de conge', () => {
  describe('remove()', () => {
    it.each([
      ['brouillon', 'Draft'],
      ['retournee', 'Returned'],
    ])('autorise le retrait pour une demande %s meme si obligatoire', async (_label, status) => {
      const { service, prisma } = build({ Status: status, documentRequired: true });
      await service.remove('att', 'user');
      expect(prisma.attachment.delete).toHaveBeenCalled();
    });

    it.each(['Pending', 'InApprovalN1', 'Approved'])(
      'refuse le retrait d un justificatif obligatoire quand la demande est %s',
      async (status) => {
        const { service, prisma } = build({ Status: status, documentRequired: true });
        await expect(service.remove('att', 'user')).rejects.toThrow(ForbiddenException);
        expect(prisma.attachment.delete).not.toHaveBeenCalled();
      },
    );

    it('laisse retirer une piece jointe facultative meme apres approbation (comportement inchange)', async () => {
      const { service, prisma } = build({ Status: 'Approved', documentRequired: false });
      await service.remove('att', 'user');
      expect(prisma.attachment.delete).toHaveBeenCalled();
    });

    it.each(['Registered', 'Done'])(
      'medical : autorise le retrait tant que la demande est %s (remplacement avant regularisation)',
      async (status) => {
        const { service, prisma } = build({ Status: status, documentRequired: true, workflowType: 'Medical' });
        await service.remove('att', 'user');
        expect(prisma.attachment.delete).toHaveBeenCalled();
      },
    );

    it('medical : refuse le retrait une fois la demande regularisee', async () => {
      const { service } = build({ Status: 'Regularized', documentRequired: true, workflowType: 'Medical' });
      await expect(service.remove('att', 'user')).rejects.toThrow(ForbiddenException);
    });

    it('refuse toujours de supprimer la piece jointe d un autre', async () => {
      const { service } = build({ Status: 'Draft', documentRequired: false });
      await expect(service.remove('att', 'someone-else')).rejects.toThrow(ForbiddenException);
    });
  });

  describe('upload() : droits', () => {
    const file = { originalname: 'certificat.pdf', buffer: Buffer.from('x'), mimetype: 'application/pdf' } as Express.Multer.File;

    it('autorise le createur de la demande (saisie pour un tiers) sans permission particuliere', async () => {
      const { service, prisma } = build({ Status: 'Draft', documentRequired: true });
      await service.upload('LeaveRequest', 'req', file, 'creator', new Set());
      expect(prisma.attachment.create).toHaveBeenCalled();
    });

    it('autorise le beneficiaire', async () => {
      const { service, prisma } = build({ Status: 'Draft', documentRequired: true });
      await service.upload('LeaveRequest', 'req', file, 'beneficiary', new Set());
      expect(prisma.attachment.create).toHaveBeenCalled();
    });

    it('refuse un tiers sans permission', async () => {
      const { service, prisma } = build({ Status: 'Draft', documentRequired: true });
      await expect(service.upload('LeaveRequest', 'req', file, 'stranger', new Set())).rejects.toThrow(ForbiddenException);
      expect(prisma.attachment.create).not.toHaveBeenCalled();
    });

    it('autorise un porteur de CONGE_VOIR_EQUIPE', async () => {
      const { service, prisma } = build({ Status: 'Draft', documentRequired: true });
      await service.upload('LeaveRequest', 'req', file, 'manager', new Set(['CONGE_VOIR_EQUIPE']));
      expect(prisma.attachment.create).toHaveBeenCalled();
    });
  });
});

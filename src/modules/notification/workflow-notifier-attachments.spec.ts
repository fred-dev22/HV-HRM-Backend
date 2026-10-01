import { WorkflowNotifierService, type WorkflowContext } from './workflow-notifier.service';

// Justificatif joint a l'email du validateur (retour client du 28/09) :
// uniquement pour les conges, uniquement pour le validateur, jamais pour
// l'interimaire.
const FILE = { name: 'certificat.pdf', contentType: 'application/pdf', contentBytes: 'QUJD' };

function build(loaded: { files: any[]; skipped: string[] }) {
  const people: Record<string, { Id: string; FullName: string; Email: string }> = {
    emp: { Id: 'emp', FullName: 'Employe Test', Email: 'emp@test.mg' },
    val: { Id: 'val', FullName: 'Valideur Test', Email: 'val@test.mg' },
    int: { Id: 'int', FullName: 'Interim Test', Email: 'int@test.mg' },
  };
  const prisma = {
    employee: { findUniqueOrThrow: jest.fn(({ where }: any) => Promise.resolve(people[where.Id])) },
  };
  const notifications = { create: jest.fn().mockResolvedValue({}) };
  const mail = { send: jest.fn().mockResolvedValue(true) };
  const realtime = { broadcastCompany: jest.fn() };
  const attachments = { loadForEmail: jest.fn().mockResolvedValue(loaded) };
  const service = new WorkflowNotifierService(
    prisma as any, notifications as any, mail as any, realtime as any, attachments as any,
  );
  return { service, mail, attachments };
}

const leaveCtx = (extra: Partial<WorkflowContext> = {}): WorkflowContext => ({
  kind: 'leave', id: 'req-1', referenceCode: 'DMD-1', beneficiaryId: 'emp', creatorId: 'emp',
  summary: 'Congé Annuel', details: [], ...extra,
});

describe('WorkflowNotifierService : justificatif joint a l email du validateur', () => {
  it('notifySubmitted joint le fichier a l email du validateur', async () => {
    const { service, mail, attachments } = build({ files: [FILE], skipped: [] });
    await service.notifySubmitted(leaveCtx(), 'val', 'token');
    expect(attachments.loadForEmail).toHaveBeenCalledWith('LeaveRequest', 'req-1');
    const call = mail.send.mock.calls.find(([m]: any) => m.to === 'val@test.mg')!;
    expect(call[0].attachments).toEqual([FILE]);
    expect(call[0].html).not.toContain('Justificatif non joint');
  });

  it("ne joint RIEN a l'email de l'interimaire (document potentiellement medical)", async () => {
    const { service, mail } = build({ files: [FILE], skipped: [] });
    await service.notifySubmitted(leaveCtx({ interimEmployeeId: 'int' }), 'val', 'token');
    const interimCall = mail.send.mock.calls.find(([m]: any) => m.to === 'int@test.mg')!;
    expect(interimCall).toBeDefined();
    expect(interimCall[0].attachments).toBeUndefined();
  });

  it("le motif n'est pas envoye a l'interimaire, mais reste dans l'email du validateur", async () => {
    const { service, mail } = build({ files: [], skipped: [] });
    await service.notifySubmitted(
      leaveCtx({ interimEmployeeId: 'int', details: [{ label: 'Type de congé', value: 'Annuel' }, { label: 'Motif', value: 'Certificat medical confidentiel' }] }),
      'val', 'token',
    );
    const interimHtml = mail.send.mock.calls.find(([m]: any) => m.to === 'int@test.mg')![0].html;
    const validatorHtml = mail.send.mock.calls.find(([m]: any) => m.to === 'val@test.mg')![0].html;
    expect(interimHtml).not.toContain('Certificat medical confidentiel');
    expect(interimHtml).toContain('Annuel');
    expect(validatorHtml).toContain('Certificat medical confidentiel');
  });

  it("si Graph refuse le message avec pieces jointes, le validateur recoit l'email sans fichier et avec une mention", async () => {
    const { service, mail } = build({ files: [FILE], skipped: [] });
    mail.send.mockImplementation(async (m: any) => !(m.to === 'val@test.mg' && m.attachments?.length));
    await service.notifySubmitted(leaveCtx(), 'val', 'token');
    const valCalls = mail.send.mock.calls.filter(([m]: any) => m.to === 'val@test.mg');
    expect(valCalls).toHaveLength(2);
    expect(valCalls[0][0].attachments).toEqual([FILE]);
    expect(valCalls[1][0].attachments).toBeUndefined();
    expect(valCalls[1][0].html).toContain('Justificatif non joint');
    expect(valCalls[1][0].html).toContain('certificat.pdf');
  });

  it("n'envoie qu'un seul email quand tout se passe bien (pas de renvoi inutile)", async () => {
    const { service, mail } = build({ files: [FILE], skipped: [] });
    await service.notifySubmitted(leaveCtx(), 'val', 'token');
    expect(mail.send.mock.calls.filter(([m]: any) => m.to === 'val@test.mg')).toHaveLength(1);
  });

  it('notifyProgressed joint aussi le fichier au validateur du niveau suivant', async () => {
    const { service, mail } = build({ files: [FILE], skipped: [] });
    await service.notifyProgressed(leaveCtx(), 'val', 'token');
    const call = mail.send.mock.calls.find(([m]: any) => m.to === 'val@test.mg')!;
    expect(call[0].attachments).toEqual([FILE]);
  });

  it('mentionne dans l email un justificatif qui n a pas pu etre joint, nom echappe', async () => {
    const { service, mail } = build({ files: [], skipped: ['<img src=x onerror=alert(1)>.pdf'] });
    await service.notifySubmitted(leaveCtx(), 'val', 'token');
    const call = mail.send.mock.calls.find(([m]: any) => m.to === 'val@test.mg')!;
    expect(call[0].attachments).toEqual([]);
    expect(call[0].html).toContain('Justificatif non joint');
    expect(call[0].html).toContain('&lt;img src=x onerror=alert(1)&gt;.pdf');
    expect(call[0].html).not.toContain('<img src=x');
  });

  it('les demandes sans piece jointe partent comme avant (aucun fichier, aucune mention)', async () => {
    const { service, mail } = build({ files: [], skipped: [] });
    await service.notifySubmitted(leaveCtx(), 'val', 'token');
    const call = mail.send.mock.calls.find(([m]: any) => m.to === 'val@test.mg')!;
    expect(call[0].attachments).toEqual([]);
    expect(call[0].html).not.toContain('Justificatif non joint');
  });

  it("la notification in-app du validateur n'attend pas le telechargement des pieces jointes", async () => {
    const { service, mail, attachments } = build({ files: [], skipped: [] });
    let release!: (v: { files: any[]; skipped: string[] }) => void;
    attachments.loadForEmail.mockReturnValue(new Promise((resolve) => { release = resolve; }));
    const notifications = (service as any).notifications.create as jest.Mock;

    const pending = service.notifySubmitted(leaveCtx(), 'val', 'token');
    await new Promise((r) => setTimeout(r, 20));
    // Telechargement encore en cours : la cloche est deja partie, l'email pas encore.
    expect(notifications).toHaveBeenCalled();
    expect(mail.send).not.toHaveBeenCalled();

    release({ files: [FILE], skipped: [] });
    await pending;
    expect(mail.send).toHaveBeenCalledWith(expect.objectContaining({ to: 'val@test.mg', attachments: [FILE] }));
  });

  it.each(['mission', 'expense'] as const)('ne cherche aucune piece jointe pour %s', async (kind) => {
    const { service, mail, attachments } = build({ files: [FILE], skipped: [] });
    await service.notifySubmitted(leaveCtx({ kind }), 'val', 'token');
    expect(attachments.loadForEmail).not.toHaveBeenCalled();
    const call = mail.send.mock.calls.find(([m]: any) => m.to === 'val@test.mg')!;
    expect(call[0].attachments).toEqual([]);
  });
});

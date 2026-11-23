import { WorkflowNotifierService, type WorkflowContext } from './workflow-notifier.service';

// Retour client du 12/11 : l'interimaire du validateur voit la demande tout le temps
// (liste "A valider"), mais n'est PREVENU que si le validateur principal est en conge
// approuve, et jamais par email (ne pas l'agacer).
function build(primaryOnLeave: boolean) {
  const people: Record<string, { Id: string; FullName: string; Email: string }> = {
    emp: { Id: 'emp', FullName: 'Employe Test', Email: 'emp@test.mg' },
    val: { Id: 'val', FullName: 'Valideur Test', Email: 'val@test.mg' },
    int: { Id: 'int', FullName: 'Interim Test', Email: 'int@test.mg' },
  };
  const prisma = {
    employee: { findUniqueOrThrow: jest.fn(({ where }: any) => Promise.resolve(people[where.Id])) },
    leaveRequest: { findFirst: jest.fn().mockResolvedValue(primaryOnLeave ? { Id: 'conge' } : null) },
  };
  const notifications = { create: jest.fn().mockResolvedValue({}) };
  const mail = { send: jest.fn().mockResolvedValue(true) };
  const realtime = { broadcastCompany: jest.fn() };
  const attachments = { loadForEmail: jest.fn().mockResolvedValue({ files: [], skipped: [] }) };
  const service = new WorkflowNotifierService(prisma as any, notifications as any, mail as any, realtime as any, attachments as any);
  return { service, mail, notifications, prisma };
}

const ctx: WorkflowContext = {
  kind: 'leave', id: 'req-1', referenceCode: 'DMD-1', beneficiaryId: 'emp', creatorId: 'emp', summary: 'Congé Annuel', details: [],
};

const notifiedIds = (notifications: { create: jest.Mock }) => notifications.create.mock.calls.map(([n]: any) => n.employeeId);

describe("WorkflowNotifierService : interimaire du validateur", () => {
  it("validateur present : l'interimaire n'a ni notification ni email", async () => {
    const { service, mail, notifications } = build(false);
    await service.notifySubmitted(ctx, 'val', 'token', ['int']);
    expect(notifiedIds(notifications)).toContain('val');
    expect(notifiedIds(notifications)).not.toContain('int');
    expect(mail.send.mock.calls.some(([m]: any) => m.to === 'int@test.mg')).toBe(false);
  });

  it("validateur en conge approuve : l'interimaire est notifie dans l'application, jamais par email", async () => {
    const { service, mail, notifications } = build(true);
    await service.notifySubmitted(ctx, 'val', 'token', ['int']);
    const interimNotif = notifications.create.mock.calls.map(([n]: any) => n).find((n: any) => n.employeeId === 'int');
    expect(interimNotif).toBeDefined();
    expect(interimNotif.message).toContain("en tant qu'intérimaire");
    expect(mail.send.mock.calls.some(([m]: any) => m.to === 'int@test.mg')).toBe(false);
    // le validateur principal garde son email
    expect(mail.send.mock.calls.some(([m]: any) => m.to === 'val@test.mg')).toBe(true);
  });
});

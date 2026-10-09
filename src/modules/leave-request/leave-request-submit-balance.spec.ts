import { BadRequestException } from '@nestjs/common';
import { LeaveRequestService } from './leave-request.service';

// Retour client du 08/10 : un solde insuffisant empeche de SOUMETTRE la demande
// (le brouillon reste possible) ; le preavis, lui, ne bloque toujours pas.
// assertNoOverlap (etape suivante) sert de sentinelle : l'atteindre prouve que
// le controle du solde est passe.
const REACHED_OVERLAP = new Error('SENTINELLE_OVERLAP');

function build(opts: { balance: number; days: number; daysPerYear?: number; workflowType?: string; minNoticeDays?: number; block?: boolean }) {
  const leaveType = {
    Id: 'type',
    Name: 'Congé annuel',
    DocumentRequired: false,
    WorkflowType: opts.workflowType ?? 'Standard',
    DaysPerYear: opts.daysPerYear ?? 30,
    MinNoticeDays: opts.minNoticeDays ?? 0,
    ...(opts.block === undefined ? {} : { BlockIfInsufficientBalance: opts.block }),
  };
  const prisma = {
    employee: { findUniqueOrThrow: jest.fn().mockResolvedValue({ Id: 'emp' }) },
    leaveType: { findUniqueOrThrow: jest.fn().mockResolvedValue(leaveType) },
    leaveRequest: {
      findUnique: jest.fn().mockResolvedValue({
        Id: 'req',
        EmployeeId: 'emp',
        CreatedBy: 'emp',
        LeaveTypeId: 'type',
        Status: 'Draft',
        IsDeleted: false,
        DaysCount: opts.days,
        StartDate: new Date('2026-10-01T00:00:00Z'),
        EndDate: new Date('2026-10-02T00:00:00Z'),
        leaveType,
      }),
    },
  };
  const transactions = { getBalance: jest.fn().mockResolvedValue(opts.balance) };
  const service = new LeaveRequestService(prisma as any, {} as any, transactions as any, {} as any, {} as any);
  (service as any).assertNoOverlap = jest.fn().mockRejectedValue(REACHED_OVERLAP);
  return { service, transactions };
}

describe('LeaveRequestService.submit : solde insuffisant', () => {
  it('bloque la soumission quand la demande depasse le solde', async () => {
    const { service, transactions } = build({ balance: 3, days: 5 });
    await expect(service.submit('req', 'emp', false)).rejects.toThrow(BadRequestException);
    await expect(service.submit('req', 'emp', false)).rejects.toThrow(/Solde insuffisant : 3 jour\(s\) disponible\(s\) pour 5/);
    expect(transactions.getBalance).toHaveBeenCalledWith('emp', 'type');
  });

  it('bloque quand le solde est nul', async () => {
    const { service } = build({ balance: 0, days: 1 });
    await expect(service.submit('req', 'emp', false)).rejects.toThrow(BadRequestException);
  });

  it('laisse passer quand le solde couvre exactement la demande', async () => {
    const { service } = build({ balance: 5, days: 5 });
    await expect(service.submit('req', 'emp', false)).rejects.toBe(REACHED_OVERLAP);
  });

  it('ne s applique pas a un type sans quota (conge non paye)', async () => {
    const { service, transactions } = build({ balance: 0, days: 10, daysPerYear: 0 });
    await expect(service.submit('req', 'emp', false)).rejects.toBe(REACHED_OVERLAP);
    expect(transactions.getBalance).not.toHaveBeenCalled();
  });

  it('bloque aussi un type medical quand loption est active (par defaut)', async () => {
    const { service } = build({ balance: 0, days: 3, workflowType: 'Medical' });
    await expect(service.submit('req', 'emp', false)).rejects.toThrow(/Solde insuffisant/);
  });

  it('ne bloque pas quand loption du type est desactivee (ex. medical), meme solde nul', async () => {
    const { service, transactions } = build({ balance: 0, days: 3, workflowType: 'Medical', block: false });
    await expect(service.submit('req', 'emp', false)).rejects.toBe(REACHED_OVERLAP);
    expect(transactions.getBalance).not.toHaveBeenCalled();
  });

  it('option activee explicitement : bloque', async () => {
    const { service } = build({ balance: 1, days: 2, block: true });
    await expect(service.submit('req', 'emp', false)).rejects.toThrow(BadRequestException);
  });

  it('le preavis minimum ne bloque pas (solde suffisant, demande trop tardive)', async () => {
    const { service } = build({ balance: 10, days: 2, minNoticeDays: 365 });
    await expect(service.submit('req', 'emp', false)).rejects.toBe(REACHED_OVERLAP);
  });
});

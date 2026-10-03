import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { EnrollmentService } from './enrollment/enrollment.service';
import { SessionService } from './session/session.service';
import { BudgetService } from './budget/budget.service';
import { ProviderService } from './provider/provider.service';
import { CourseService } from './course/course.service';
import { addMonthsUtc, nextDecemberFirst } from './training.constants';

// Regles metier du module Formation, testees sur des services branches a un
// faux Prisma (aucune base requise).

function fakePrisma(overrides: Record<string, unknown> = {}) {
  const prisma: Record<string, any> = {
    trainingSession: { findUnique: jest.fn(), update: jest.fn(), create: jest.fn(), count: jest.fn().mockResolvedValue(0), findMany: jest.fn() },
    trainingEnrollment: {
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      create: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      findMany: jest.fn().mockResolvedValue([]),
    },
    trainingCourse: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn(), count: jest.fn().mockResolvedValue(0) },
    trainingProvider: { findUnique: jest.fn(), update: jest.fn() },
    trainingBudgetLine: { findUnique: jest.fn(), update: jest.fn(), create: jest.fn() },
    employee: { findUnique: jest.fn() },
    ...overrides,
  };
  prisma.$transaction = jest.fn(async (fn: (tx: unknown) => unknown) => fn(prisma));
  return prisma;
}

const shapedEnrollmentRow = (status: string) => ({
  Id: 'enr', SessionId: 'ses', EmployeeId: 'emp', RequestedAt: new Date('2026-10-01'), Status: status,
  AttendanceSheetSigned: false, HotScore: null, HotComment: null, HotDate: null,
  ColdDueAt: null, ColdScore: null, ColdComment: null, ColdDate: null,
  session: { ScheduledAt: new Date('2026-10-06T05:30:00Z'), course: { Title: 'Excel' } },
  employee: { FullName: 'Jean', organizationUnit: { Name: 'DG' } },
  requestedBy: { FullName: 'RH' },
});

describe('EnrollmentService.create', () => {
  function build(session: any, employee: any = { Id: 'emp', IsDeleted: false, Status: 'Active' }) {
    const prisma = fakePrisma();
    prisma.trainingSession.findUnique.mockResolvedValue(session);
    prisma.employee.findUnique.mockResolvedValue(employee);
    prisma.trainingEnrollment.create.mockResolvedValue({ Id: 'enr' });
    prisma.trainingEnrollment.findUniqueOrThrow.mockResolvedValue(shapedEnrollmentRow('Requested'));
    return { service: new EnrollmentService(prisma as any), prisma };
  }
  const session = (over: object = {}) => ({
    Id: 'ses', IsDeleted: false, Status: 'Scheduled', Capacity: 2, enrollments: [], ...over,
  });

  it('cree une demande et renvoie la forme attendue par le frontend', async () => {
    const { service, prisma } = build(session());
    const result = await service.create({ sessionId: 'ses', employeeId: 'emp' }, 'requester');
    expect(prisma.trainingEnrollment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ SessionId: 'ses', EmployeeId: 'emp', RequestedByEmployeeId: 'requester', Status: 'Requested' }),
    });
    expect(result).toMatchObject({
      id: 'enr', courseTitle: 'Excel', employeeName: 'Jean', entityName: 'DG', requestedByName: 'RH',
      status: 'Requested', sessionScheduledAt: '2026-10-06T05:30:00.000Z', requestedAt: '2026-10-01',
    });
  });

  it('refuse une session pleine (les refus et annulations ne comptent pas)', async () => {
    const full = session({ enrollments: [
      { Status: 'Approved', EmployeeId: 'a' }, { Status: 'Requested', EmployeeId: 'b' },
      { Status: 'Rejected', EmployeeId: 'c' }, { Status: 'Cancelled', EmployeeId: 'd' },
    ] });
    const { service, prisma } = build(full);
    await expect(service.create({ sessionId: 'ses', employeeId: 'emp' }, 'r')).rejects.toThrow(/complète/);
    expect(prisma.trainingEnrollment.create).not.toHaveBeenCalled();
  });

  it('accepte quand une place est liberee par un refus', async () => {
    const free = session({ enrollments: [
      { Status: 'Approved', EmployeeId: 'a' }, { Status: 'Rejected', EmployeeId: 'b' },
    ] });
    const { service } = build(free);
    await expect(service.create({ sessionId: 'ses', employeeId: 'emp' }, 'r')).resolves.toBeDefined();
  });

  it.each(['Requested', 'Approved', 'Attended'])('refuse un doublon quand l inscription existante est %s', async (status) => {
    const { service } = build(session({ enrollments: [{ Status: status, EmployeeId: 'emp' }] }));
    await expect(service.create({ sessionId: 'ses', employeeId: 'emp' }, 'r')).rejects.toBeInstanceOf(ConflictException);
  });

  it('autorise une nouvelle inscription apres un refus du meme employe', async () => {
    const { service } = build(session({ enrollments: [{ Status: 'Rejected', EmployeeId: 'emp' }] }));
    await expect(service.create({ sessionId: 'ses', employeeId: 'emp' }, 'r')).resolves.toBeDefined();
  });

  it.each(['Done', 'Cancelled'])('refuse une session %s', async (status) => {
    const { service } = build(session({ Status: status }));
    await expect(service.create({ sessionId: 'ses', employeeId: 'emp' }, 'r')).rejects.toThrow(/plus planifiée/);
  });

  it('refuse une session supprimee ou inconnue', async () => {
    await expect(build(null).service.create({ sessionId: 'x', employeeId: 'emp' }, 'r')).rejects.toBeInstanceOf(NotFoundException);
    await expect(build(session({ IsDeleted: true })).service.create({ sessionId: 'x', employeeId: 'emp' }, 'r')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('refuse un employe inconnu, supprime ou inactif', async () => {
    await expect(build(session(), null).service.create({ sessionId: 'ses', employeeId: 'emp' }, 'r')).rejects.toBeInstanceOf(NotFoundException);
    await expect(build(session(), { Id: 'emp', IsDeleted: true, Status: 'Active' }).service.create({ sessionId: 'ses', employeeId: 'emp' }, 'r')).rejects.toBeInstanceOf(NotFoundException);
    await expect(build(session(), { Id: 'emp', IsDeleted: false, Status: 'Inactive' }).service.create({ sessionId: 'ses', employeeId: 'emp' }, 'r')).rejects.toThrow(/inactif/);
  });
});

describe('EnrollmentService transitions', () => {
  function build(status: string) {
    const prisma = fakePrisma();
    prisma.trainingEnrollment.findUnique.mockResolvedValue({ Id: 'enr', Status: status, HotScore: null, ColdScore: null });
    prisma.trainingEnrollment.findUniqueOrThrow.mockResolvedValue(shapedEnrollmentRow('Approved'));
    return { service: new EnrollmentService(prisma as any), prisma };
  }

  it.each([
    ['approve', 'Requested', 'Approved'], ['reject', 'Requested', 'Rejected'],
    ['cancel', 'Requested', 'Cancelled'], ['cancel', 'Approved', 'Cancelled'], ['attend', 'Approved', 'Attended'],
  ] as const)('%s depuis %s donne %s', async (action, from, to) => {
    const { service, prisma } = build(from);
    await (service as any)[action]('enr', 'me');
    expect(prisma.trainingEnrollment.update).toHaveBeenCalledWith({
      where: { Id: 'enr' },
      data: expect.objectContaining({ Status: to }),
    });
  });

  it('la presence signe la feuille d emargement', async () => {
    const { service, prisma } = build('Approved');
    await service.attend('enr', 'me');
    expect(prisma.trainingEnrollment.update.mock.calls[0][0].data.AttendanceSheetSigned).toBe(true);
  });

  it.each([
    ['approve', 'Rejected'], ['approve', 'Approved'], ['reject', 'Approved'], ['reject', 'Rejected'],
    ['cancel', 'Rejected'], ['cancel', 'Attended'], ['attend', 'Requested'], ['attend', 'Rejected'],
  ] as const)('%s est refuse depuis %s et ne modifie rien', async (action, from) => {
    const { service, prisma } = build(from);
    await expect((service as any)[action]('enr', 'me')).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.trainingEnrollment.update).not.toHaveBeenCalled();
  });

  it.each([
    ['approve', "Impossible d'approuver une inscription au statut \"Rejected\""],
    ['reject', 'Impossible de refuser une inscription au statut "Rejected"'],
    ['cancel', "Impossible d'annuler une inscription au statut \"Rejected\""],
    ['attend', 'Impossible de marquer présente une inscription au statut "Rejected"'],
  ] as const)('%s : message d erreur lisible', async (action, message) => {
    const { service } = build('Rejected');
    await expect((service as any)[action]('enr', 'me')).rejects.toThrow(message);
  });

  it('inscription inconnue : 404', async () => {
    const prisma = fakePrisma();
    prisma.trainingEnrollment.findUnique.mockResolvedValue(null);
    await expect(new EnrollmentService(prisma as any).approve('x', 'me')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('EnrollmentService evaluations', () => {
  function build(row: object) {
    const prisma = fakePrisma();
    prisma.trainingEnrollment.findUnique.mockResolvedValue({ Id: 'enr', HotScore: null, ColdScore: null, ...row });
    prisma.trainingEnrollment.findUniqueOrThrow.mockResolvedValue(shapedEnrollmentRow('Attended'));
    return { service: new EnrollmentService(prisma as any), prisma };
  }

  it('evaluation a chaud : programme l evaluation a froid 3 mois plus tard', async () => {
    const { service, prisma } = build({ Status: 'Attended' });
    await service.submitHotEvaluation('enr', { score: 4.5, comment: ' Très bien ', date: '2026-10-10' }, 'me');
    const data = prisma.trainingEnrollment.update.mock.calls[0][0].data;
    expect(data.HotScore).toBe(4.5);
    expect(data.HotComment).toBe('Très bien');
    expect(data.HotDate.toISOString().slice(0, 10)).toBe('2026-10-10');
    expect(data.ColdDueAt.toISOString().slice(0, 10)).toBe('2027-01-10');
  });

  it.each(['Requested', 'Approved', 'Rejected', 'Cancelled'])('a chaud : refuse sans presence (statut %s)', async (status) => {
    const { service, prisma } = build({ Status: status });
    await expect(service.submitHotEvaluation('enr', { score: 3, comment: 'x' }, 'me')).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.trainingEnrollment.update).not.toHaveBeenCalled();
  });

  it('a chaud : refuse une seconde evaluation', async () => {
    const { service } = build({ Status: 'Attended', HotScore: 4 });
    await expect(service.submitHotEvaluation('enr', { score: 3, comment: 'x' }, 'me')).rejects.toBeInstanceOf(ConflictException);
  });

  it('a froid : exige presence et evaluation a chaud', async () => {
    await expect(build({ Status: 'Attended' }).service.submitColdEvaluation('enr', { score: 3, comment: 'x' }, 'me')).rejects.toBeInstanceOf(BadRequestException);
    await expect(build({ Status: 'Approved', HotScore: 4 }).service.submitColdEvaluation('enr', { score: 3, comment: 'x' }, 'me')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('a froid : enregistre la note, une seule fois', async () => {
    const ok = build({ Status: 'Attended', HotScore: 4 });
    await ok.service.submitColdEvaluation('enr', { score: 3, comment: 'ok', date: '2027-01-12' }, 'me');
    const data = ok.prisma.trainingEnrollment.update.mock.calls[0][0].data;
    expect(data.ColdScore).toBe(3);
    expect(data.ColdDate.toISOString().slice(0, 10)).toBe('2027-01-12');
    await expect(build({ Status: 'Attended', HotScore: 4, ColdScore: 3 }).service.submitColdEvaluation('enr', { score: 2, comment: 'x' }, 'me')).rejects.toBeInstanceOf(ConflictException);
  });

  it('refuse une date invalide', async () => {
    const { service } = build({ Status: 'Attended' });
    await expect(service.submitHotEvaluation('enr', { score: 3, comment: 'x', date: '2026-13-45' }, 'me')).rejects.toThrow(/Date invalide/);
  });
});

describe('SessionService', () => {
  const course = (over: object = {}) => ({ Id: 'crs', IsDeleted: false, Status: 'InProgress', MaxParticipants: 10, ...over });
  const dto = (over: object = {}) => ({
    courseId: 'crs', scheduledAt: '2026-10-06T05:30:00.000Z', endAt: '2026-10-06T13:30:00.000Z',
    mode: 'InPerson', location: 'Salle A', trainerName: 'Hery', capacity: 8, ...over,
  }) as any;
  function build(c: any = course()) {
    const prisma = fakePrisma();
    prisma.trainingCourse.findUnique.mockResolvedValue(c);
    prisma.trainingSession.create.mockResolvedValue({
      Id: 'ses', ReferenceCode: 'SES001', CourseId: 'crs', ScheduledAt: new Date(dto().scheduledAt), EndAt: new Date(dto().endAt),
      Mode: 'InPerson', Location: 'Salle A', MeetingLink: null, TrainerName: 'Hery', Status: 'Scheduled', Capacity: 8,
      course: { Id: 'crs', Title: 'Excel' }, enrollments: [{ Status: 'Approved' }, { Status: 'Rejected' }],
    });
    return { service: new SessionService(prisma as any), prisma };
  }

  it('planifie une session, calcule le code et l effectif', async () => {
    const { service, prisma } = build();
    const result = await service.create(dto(), 'me');
    expect(prisma.trainingSession.create.mock.calls[0][0].data.ReferenceCode).toBe('SES001');
    expect(result).toMatchObject({ referenceCode: 'SES001', courseTitle: 'Excel', status: 'Scheduled', enrolledCount: 1 });
  });

  it('refuse une formation archivee, inconnue ou supprimee', async () => {
    await expect(build(course({ Status: 'Archived' })).service.create(dto(), 'me')).rejects.toThrow(/archivée/);
    await expect(build(null).service.create(dto(), 'me')).rejects.toBeInstanceOf(NotFoundException);
    await expect(build(course({ IsDeleted: true })).service.create(dto(), 'me')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('refuse une fin avant le debut', async () => {
    await expect(build().service.create(dto({ endAt: '2026-10-06T04:00:00.000Z' }), 'me')).rejects.toThrow(/après le début/);
  });

  it('presentiel sans lieu et visio sans lien sont refuses', async () => {
    await expect(build().service.create(dto({ location: ' ' }), 'me')).rejects.toThrow(/lieu/);
    await expect(build().service.create(dto({ mode: 'VideoCall', location: undefined }), 'me')).rejects.toThrow(/visioconférence/);
  });

  it('refuse une capacite superieure a l effectif maximum de la formation', async () => {
    await expect(build().service.create(dto({ capacity: 11 }), 'me')).rejects.toThrow(/dépasse l'effectif maximum/);
  });

  it('en visio, le lieu n est pas conserve (et inversement)', async () => {
    const { service, prisma } = build();
    await service.create(dto({ mode: 'VideoCall', meetingLink: 'https://meet/x', location: 'ignore' }), 'me');
    const data = prisma.trainingSession.create.mock.calls[0][0].data;
    expect(data.Location).toBeNull();
    expect(data.MeetingLink).toBe('https://meet/x');
  });

  it('annuler : n est possible que depuis Scheduled', async () => {
    for (const status of ['Done', 'Cancelled']) {
      const prisma = fakePrisma();
      prisma.trainingSession.findUnique.mockResolvedValue({ Id: 'ses', IsDeleted: false, Status: status });
      const service = new SessionService(prisma as any);
      await expect(service.cancel('ses', 'me')).rejects.toThrow(/plus planifiée/);
      await expect(service.markDone('ses', 'me')).rejects.toThrow(/plus planifiée/);
    }
  });

  it('annuler : annule les inscriptions en cours dans la meme transaction, pas les presences', async () => {
    const prisma = fakePrisma();
    prisma.trainingSession.findUnique.mockResolvedValue({ Id: 'ses', IsDeleted: false, Status: 'Scheduled' });
    prisma.trainingSession.update.mockResolvedValue({
      Id: 'ses', ReferenceCode: 'SES001', CourseId: 'crs', ScheduledAt: new Date(), EndAt: new Date(), Mode: 'InPerson',
      Location: 'A', MeetingLink: null, TrainerName: 'H', Status: 'Cancelled', Capacity: 8, course: { Id: 'crs', Title: 'E' }, enrollments: [],
    });
    const result = await new SessionService(prisma as any).cancel('ses', 'me');
    expect(prisma.$transaction).toHaveBeenCalled();
    expect(prisma.trainingEnrollment.updateMany).toHaveBeenCalledWith({
      where: { SessionId: 'ses', Status: { in: ['Requested', 'Approved'] } },
      data: expect.objectContaining({ Status: 'Cancelled' }),
    });
    expect(result.status).toBe('Cancelled');
  });
});

describe('BudgetService', () => {
  const row = (status: string) => ({
    Id: 'b', IsDeleted: false, Year: 2027, EntityName: 'DG', CourseTitle: null, Allocated: '1000.50', Used: '0', RequestStatus: status, Comment: null,
  });
  function build(status: string) {
    const prisma = fakePrisma();
    prisma.trainingBudgetLine.findUnique.mockResolvedValue(row(status));
    prisma.trainingBudgetLine.update.mockResolvedValue(row('Approved'));
    return { service: new BudgetService(prisma as any), prisma };
  }

  it('une demande en attente peut etre approuvee ou refusee', async () => {
    for (const action of ['approve', 'reject'] as const) {
      const { service, prisma } = build('Pending');
      await service[action]('b', 'me');
      expect(prisma.trainingBudgetLine.update).toHaveBeenCalled();
    }
  });

  it.each(['Approved', 'Rejected', 'Draft'])('une demande %s ne peut plus etre decidee', async (status) => {
    const { service, prisma } = build(status);
    await expect(service.approve('b', 'me')).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.reject('b', 'me')).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.trainingBudgetLine.update).not.toHaveBeenCalled();
  });

  it('une nouvelle demande est en attente, avec les montants convertis en nombres', async () => {
    const prisma = fakePrisma();
    prisma.trainingBudgetLine.create.mockResolvedValue(row('Pending'));
    const result = await new BudgetService(prisma as any).create(
      { year: 2027, entityName: ' DG ', allocated: 1000.5 } as any, 'me',
    );
    expect(prisma.trainingBudgetLine.create.mock.calls[0][0].data).toMatchObject({ EntityName: 'DG', RequestStatus: 'Pending', CourseTitle: null });
    expect(result).toMatchObject({ allocated: 1000.5, used: 0, requestStatus: 'Pending' });
  });
});

describe('ProviderService', () => {
  it('l evaluation enregistre la note du jour et reprogramme au 1er decembre suivant', async () => {
    const prisma = fakePrisma();
    prisma.trainingProvider.findUnique.mockResolvedValue({ Id: 'p', IsDeleted: false });
    prisma.trainingProvider.update.mockResolvedValue({
      Id: 'p', Name: 'N', ContactName: 'C', Email: 'e@x.mg', Phone: '1', Specialties: '', LastEvaluationScore: '4.5',
      LastEvaluationDate: new Date('2026-10-03'), NextEvaluationDueAt: new Date('2026-12-01'), Status: 'active',
    });
    const result = await new ProviderService(prisma as any).evaluate('p', 4.5, 'me');
    const data = prisma.trainingProvider.update.mock.calls[0][0].data;
    expect(data.LastEvaluationScore).toBe(4.5);
    expect(data.NextEvaluationDueAt.getUTCMonth()).toBe(11);
    expect(data.NextEvaluationDueAt.getUTCDate()).toBe(1);
    expect(result).toMatchObject({ lastEvaluationScore: 4.5, nextEvaluationDueAt: '2026-12-01', status: 'active' });
  });

  it('prestataire supprime ou inconnu : 404', async () => {
    const prisma = fakePrisma();
    prisma.trainingProvider.findUnique.mockResolvedValue({ Id: 'p', IsDeleted: true });
    await expect(new ProviderService(prisma as any).update('p', {}, 'me')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('CourseService', () => {
  const created = {
    Id: 'c', ReferenceCode: 'FOR004', Title: 'T', Category: 'C', Description: 'D', DurationHours: 7, MaxParticipants: 10,
    ProviderId: null, Status: 'InPreparation', BudgetAllocated: '500000', BudgetUsed: '0', CreatedAt: new Date('2026-10-03'),
    provider: null, sessions: [{ Id: 's1' }],
  };

  it('cree une formation en preparation avec un code sequentiel', async () => {
    const prisma = fakePrisma();
    prisma.trainingCourse.count.mockResolvedValue(3);
    prisma.trainingCourse.create.mockResolvedValue(created);
    const result = await new CourseService(prisma as any).create(
      { title: ' T ', category: 'C', description: 'D', durationHours: 7, maxParticipants: 10, budgetAllocated: 500000 }, 'me',
    );
    expect(prisma.trainingCourse.create.mock.calls[0][0].data).toMatchObject({ ReferenceCode: 'FOR004', Title: 'T', Status: 'InPreparation' });
    expect(result).toMatchObject({ referenceCode: 'FOR004', budgetAllocated: 500000, sessionsCount: 1, createdAt: '2026-10-03' });
  });

  it('refuse un prestataire inconnu', async () => {
    const prisma = fakePrisma();
    prisma.trainingProvider.findUnique.mockResolvedValue(null);
    await expect(new CourseService(prisma as any).create(
      { title: 'T', category: 'C', description: 'D', durationHours: 7, maxParticipants: 10, providerId: 'x', budgetAllocated: 0 }, 'me',
    )).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('utilitaires de dates', () => {
  it('nextDecemberFirst : 1er decembre de l annee, ou de la suivante une fois passe', () => {
    expect(nextDecemberFirst(new Date('2026-10-03T12:00:00Z')).toISOString().slice(0, 10)).toBe('2026-12-01');
    expect(nextDecemberFirst(new Date('2026-12-01T00:00:00Z')).toISOString().slice(0, 10)).toBe('2027-12-01');
    expect(nextDecemberFirst(new Date('2026-12-15T00:00:00Z')).toISOString().slice(0, 10)).toBe('2027-12-01');
  });

  it('addMonthsUtc : +3 mois', () => {
    expect(addMonthsUtc(new Date('2026-10-10T00:00:00Z'), 3).toISOString().slice(0, 10)).toBe('2027-01-10');
    expect(addMonthsUtc(new Date('2026-11-30T00:00:00Z'), 3).toISOString().slice(0, 4)).toBe('2027');
  });
});

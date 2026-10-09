import { BadRequestException } from '@nestjs/common';
import { LeaveRequestService } from './leave-request.service';

// Le ciblage d'un type de conge (genre, expatrie, entite) doit etre garanti
// par le serveur : l'ecran ne propose que les types eligibles, mais un appel
// direct a l'API creait une demande de conge maternite pour un homme.
describe('LeaveRequestService : eligibilite du type de conge', () => {
  const homme = { Id: 'h1', Gender: 'M', IsExpatriate: false, OrganizationUnitId: 'ou1', EmployeeCategoryId: null };
  const femme = { Id: 'f1', Gender: 'F', IsExpatriate: false, OrganizationUnitId: 'ou1', EmployeeCategoryId: null };

  const type = (over: Record<string, unknown> = {}) => ({
    Id: 'lt1',
    Name: 'Congé maternité',
    CountCalendarDays: false,
    AppliesToGender: null,
    AppliesToExpatriate: null,
    OrganizationUnitId: null,
    ...over,
  });

  function build(opts: { employee: unknown; leaveType: unknown; existingTypeId?: string }) {
    const prisma = {
      employee: {
        findUnique: jest.fn().mockResolvedValue(opts.employee),
        findUniqueOrThrow: jest.fn().mockResolvedValue(opts.employee),
      },
      leaveType: {
        findUnique: jest.fn().mockResolvedValue(opts.leaveType),
        findUniqueOrThrow: jest.fn().mockResolvedValue(opts.leaveType),
      },
      leaveRequest: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ Id: 'req' }),
        update: jest.fn().mockResolvedValue({ Id: 'req' }),
        findUnique: jest.fn().mockResolvedValue({
          Id: 'req',
          EmployeeId: 'h1',
          CreatedBy: 'h1',
          Status: 'Draft',
          IsDeleted: false,
          LeaveTypeId: opts.existingTypeId ?? 'ancien',
          StartDate: new Date('2026-12-14T00:00:00Z'),
          EndDate: new Date('2026-12-15T00:00:00Z'),
          StartPeriod: 'full',
          EndPeriod: 'full',
          DaysCount: 2,
        }),
      },
    };
    const service = new LeaveRequestService(prisma as never, {} as never, {} as never, {} as never, {} as never);
    (service as unknown as { computeWorkingDays: jest.Mock }).computeWorkingDays = jest.fn().mockResolvedValue(2);
    return { service, prisma };
  }

  const dto = { LeaveTypeId: 'lt1', StartDate: '2026-12-14', EndDate: '2026-12-15' };

  describe('create()', () => {
    it('refuse un type reserve aux femmes pour un homme, sans rien enregistrer', async () => {
      const { service, prisma } = build({ employee: homme, leaveType: type({ AppliesToGender: 'F' }) });
      await expect(service.create(dto as never, 'h1')).rejects.toBeInstanceOf(BadRequestException);
      await expect(service.create(dto as never, 'h1')).rejects.toThrow(/Congé maternité.*ne s'applique pas/);
      expect(prisma.leaveRequest.create).not.toHaveBeenCalled();
    });

    it('accepte le meme type pour une femme', async () => {
      const { service, prisma } = build({ employee: femme, leaveType: type({ AppliesToGender: 'F' }) });
      await service.create(dto as never, 'f1');
      expect(prisma.leaveRequest.create).toHaveBeenCalled();
    });

    it('accepte un type sans ciblage pour tout le monde', async () => {
      const { service, prisma } = build({ employee: homme, leaveType: type() });
      await service.create(dto as never, 'h1');
      expect(prisma.leaveRequest.create).toHaveBeenCalled();
    });

    it('refuse un type reserve aux expatries pour un local, et un type d\'une autre entite', async () => {
      const a = build({ employee: homme, leaveType: type({ AppliesToExpatriate: true }) });
      await expect(a.service.create(dto as never, 'h1')).rejects.toBeInstanceOf(BadRequestException);
      const b = build({ employee: homme, leaveType: type({ OrganizationUnitId: 'ou2' }) });
      await expect(b.service.create(dto as never, 'h1')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('la creation pour un autre employe est controlee sur le BENEFICIAIRE, pas sur l\'auteur', async () => {
      const { service, prisma } = build({ employee: homme, leaveType: type({ AppliesToGender: 'F' }) });
      await expect(service.create({ ...dto, EmployeeId: 'h1' } as never, 'admin-femme')).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.employee.findUnique).toHaveBeenCalledWith({ where: { Id: 'h1' } });
    });
  });

  describe('update() d\'un brouillon', () => {
    it('refuse de changer le type vers un type non eligible', async () => {
      const { service, prisma } = build({ employee: homme, leaveType: type({ AppliesToGender: 'F' }) });
      await expect(service.update('req', { LeaveTypeId: 'lt1' } as never, 'h1', false)).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.leaveRequest.update).not.toHaveBeenCalled();
    });

    it('accepte de changer vers un type eligible', async () => {
      const { service, prisma } = build({ employee: homme, leaveType: type() });
      await service.update('req', { LeaveTypeId: 'lt1' } as never, 'h1', false);
      expect(prisma.leaveRequest.update).toHaveBeenCalled();
    });

    it('ne remet pas en cause une demande existante : changer les dates sans changer le type reste possible', async () => {
      const { service, prisma } = build({
        employee: homme,
        leaveType: type({ AppliesToGender: 'F' }),
        existingTypeId: 'lt1',
      });
      await service.update('req', { StartDate: '2026-12-16', EndDate: '2026-12-17' } as never, 'h1', false);
      expect(prisma.leaveRequest.update).toHaveBeenCalled();
    });
  });
});

import { BadRequestException } from '@nestjs/common';
import { CalendarService } from './calendar.service';
import { CalendarWorkDayDto } from './dto/calendar-work-day.dto';

const WEEK: CalendarWorkDayDto[] = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map((DayOfWeek) => ({
  DayOfWeek,
  IsEnabled: false,
}));
const A = 'aaaaaaaa-1111-4111-8111-111111111111';
const B = 'bbbbbbbb-2222-4222-8222-222222222222';

describe('memes horaires pour plusieurs employes', () => {
  function build(existing: { Id: string; EmployeeId: string }[], found = [A, B]) {
    const prisma = {
      employee: { findMany: jest.fn().mockResolvedValue(found.map((Id) => ({ Id: Id.toUpperCase(), FullName: 'Nom' }))) },
      calendar: { findMany: jest.fn().mockResolvedValue(existing), create: jest.fn(), updateMany: jest.fn() },
      calendarWorkDay: { deleteMany: jest.fn(), createMany: jest.fn() },
      $transaction: jest.fn(async (fn: (tx: unknown) => unknown) => fn(prisma)),
    };
    return { service: new CalendarService(prisma as never), prisma };
  }

  it('cree le calendrier de ceux qui n en ont pas et remplace la semaine des autres', async () => {
    const { service, prisma } = build([{ Id: 'cal-a', EmployeeId: A.toUpperCase() }]);
    await expect(service.applyToEmployees({ EmployeeIds: [A, B], WorkDays: WEEK }, 'acteur')).resolves.toEqual({ Created: 1, Updated: 1 });
    expect(prisma.calendarWorkDay.deleteMany).toHaveBeenCalledWith({ where: { CalendarId: { in: ['cal-a'] } } });
    expect(prisma.calendarWorkDay.createMany.mock.calls[0]![0].data).toHaveLength(7);
    expect(prisma.calendar.create).toHaveBeenCalledTimes(1);
    expect(prisma.calendar.create.mock.calls[0]![0].data).toMatchObject({ EmployeeId: B.toUpperCase(), CreatedBy: 'acteur' });
  });

  it('un meme employe cite deux fois ne recoit qu un calendrier', async () => {
    const { service, prisma } = build([], [A]);
    await service.applyToEmployees({ EmployeeIds: [A, A.toUpperCase()], WorkDays: WEEK }, 'acteur');
    expect(prisma.calendar.create).toHaveBeenCalledTimes(1);
  });

  it('refuse tout si un employe est introuvable', async () => {
    const { service, prisma } = build([], [A]);
    await expect(service.applyToEmployees({ EmployeeIds: [A, B], WorkDays: WEEK }, 'acteur')).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  const monday = (start: string, end: string) =>
    WEEK.map((d) =>
      d.DayOfWeek === 'Monday'
        ? { ...d, IsEnabled: true, StartTime: new Date(`1970-01-01T${start}:00Z`), EndTime: new Date(`1970-01-01T${end}:00Z`) }
        : d,
    );

  it('refuse un horaire incoherent avant toute ecriture', async () => {
    const { service, prisma } = build([]);
    await expect(service.applyToEmployees({ EmployeeIds: [A], WorkDays: monday('08:00', '08:00') }, 'acteur')).rejects.toThrow(
      "doit être différente de l'heure de début",
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('accepte un poste de nuit', async () => {
    const { service, prisma } = build([], [A]);
    await service.applyToEmployees({ EmployeeIds: [A], WorkDays: monday('22:00', '06:00') }, 'acteur');
    expect(prisma.calendar.create).toHaveBeenCalledTimes(1);
  });
});

describe('un seul calendrier par categorie', () => {
  it('refuse le second', async () => {
    const prisma = { calendar: { findFirst: jest.fn().mockResolvedValue({ Id: 'deja' }) }, $transaction: jest.fn() };
    const service = new CalendarService(prisma as never);
    await expect(service.create({ Name: 'x', EmployeeCategoryId: A, WorkDays: WEEK }, 'acteur')).rejects.toThrow(
      'Cette catégorie a déjà un calendrier dédié',
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

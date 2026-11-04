import { BadRequestException } from '@nestjs/common';
import { CalendarService } from './calendar.service';
import { WEEK_DAYS, hhmmToDate, mergeScheduleDays, type WorkDayValue } from './calendar-schedule-import';

const weekdays = WEEK_DAYS.slice(0, 5) as unknown as string[];
const hh = (d?: Date | null) => (d ? d.toISOString().slice(11, 16) : null);

describe('mergeScheduleDays', () => {
  it('cree une semaine complete : jours indiques travailles, les autres au repos', () => {
    const week = mergeScheduleDays([], { Days: weekdays, IsEnabled: true, StartTime: '08:00', EndTime: '17:00', BreakStartTime: '12:00', BreakEndTime: '13:00' });
    expect(week.map((d) => d.DayOfWeek)).toEqual([...WEEK_DAYS]);
    expect(week.slice(0, 5).every((d) => d.IsEnabled && hh(d.StartTime) === '08:00' && hh(d.EndTime) === '17:00' && d.BreakEnabled)).toBe(true);
    expect(hh(week[0]!.BreakStartTime)).toBe('12:00');
    expect(week[5]!.IsEnabled).toBe(false);
    expect(week[6]!.IsEnabled).toBe(false);
  });

  it('ne change que les jours indiques et garde les autres sans leurs identifiants', () => {
    const existing = WEEK_DAYS.map((d, i): WorkDayValue & { Id: string; CalendarId: string } => ({
      Id: `id${i}`, CalendarId: 'cal', DayOfWeek: d, IsEnabled: i < 5, StartTime: hhmmToDate('09:00'), EndTime: hhmmToDate('18:00'), BreakEnabled: false,
    }));
    const week = mergeScheduleDays(existing, { Days: ['Saturday'], IsEnabled: true, StartTime: '08:00', EndTime: '12:00' });
    expect(hh(week[5]!.StartTime)).toBe('08:00');
    expect(week[5]!.BreakEnabled).toBe(false);
    expect(hh(week[0]!.StartTime)).toBe('09:00'); // lundi inchange
    expect('Id' in week[0]!).toBe(false);
  });

  it('un jour de repos efface les heures', () => {
    const week = mergeScheduleDays([], { Days: ['Sunday'], IsEnabled: false });
    expect(week[6]).toMatchObject({ DayOfWeek: 'Sunday', IsEnabled: false, BreakEnabled: false });
  });

  it('refuse un jour travaille sans heures, ou une pause incomplete', () => {
    expect(() => mergeScheduleDays([], { Days: ['Monday'], IsEnabled: true, StartTime: '08:00' })).toThrow(BadRequestException);
    expect(() => mergeScheduleDays([], { Days: ['Monday'], IsEnabled: true, StartTime: '08:00', EndTime: '17:00', BreakStartTime: '12:00' })).toThrow(BadRequestException);
  });
});

describe('CalendarService.importSchedule', () => {
  function build(opts: { global?: unknown; category?: unknown; employeeCalendar?: unknown } = {}) {
    const created = jest.fn(async ({ data }: { data: { workDays: { create: WorkDayValue[] } } }) => ({ Id: 'new', ...data }));
    const prisma = {
      calendar: {
        findFirst: jest.fn(async ({ where }: { where: Record<string, unknown> }) => {
          if (where.IsDefault) return opts.global ?? null;
          if (where.EmployeeCategoryId) return opts.category ?? null;
          if (where.EmployeeId) return opts.employeeCalendar ?? null;
          return null;
        }),
        create: created,
        updateMany: jest.fn(),
        update: jest.fn(),
        findUniqueOrThrow: jest.fn(),
      },
      calendarWorkDay: { deleteMany: jest.fn(), createMany: jest.fn() },
      employeeCategory: { findFirst: jest.fn().mockResolvedValue({ Name: 'Production' }) },
      employee: { findFirst: jest.fn().mockResolvedValue({ FullName: 'Alice Rakoto' }) },
      $transaction: jest.fn(async (fn: (tx: unknown) => unknown) => fn(prisma)),
    };
    return { service: new CalendarService(prisma as never), prisma, created };
  }
  const change = { Days: weekdays, IsEnabled: true, StartTime: '08:00', EndTime: '17:00' };

  it('cree le calendrier de la categorie s\'il n\'existe pas', async () => {
    const { service, created } = build();
    await service.importSchedule({ Scope: 'category', TargetId: '11111111-1111-1111-1111-111111111111', ...change }, 'actor');
    const data = created.mock.calls[0]![0].data as unknown as { Name: string; EmployeeCategoryId: string };
    expect(data.Name).toBe('Horaires Production');
    expect(data.EmployeeCategoryId).toBe('11111111-1111-1111-1111-111111111111');
  });

  it('remplace la semaine du calendrier existant (jours non indiques conserves)', async () => {
    const existing = { Id: 'cal1', IsDefault: false, EmployeeCategoryId: 'c', EmployeeId: null, workDays: [] };
    const { service, prisma } = build({ category: existing });
    prisma.calendar.findUniqueOrThrow.mockResolvedValue({});
    (prisma as unknown as { calendar: { findUnique: jest.Mock } }).calendar.findUnique = jest.fn().mockResolvedValue(existing);
    await service.importSchedule({ Scope: 'category', TargetId: '11111111-1111-1111-1111-111111111111', ...change }, 'actor');
    expect(prisma.calendarWorkDay.deleteMany).toHaveBeenCalled();
    expect(prisma.calendarWorkDay.createMany.mock.calls[0]![0].data).toHaveLength(7);
  });

  it('refuse le global sans calendrier par defaut et une cible manquante', async () => {
    const { service } = build();
    await expect(service.importSchedule({ Scope: 'global', ...change }, 'a')).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.importSchedule({ Scope: 'employee', ...change }, 'a')).rejects.toBeInstanceOf(BadRequestException);
  });
});

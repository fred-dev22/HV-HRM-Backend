import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateCalendarDto } from './dto/create-calendar.dto';
import { UpdateCalendarDto } from './dto/update-calendar.dto';
import { CalendarWorkDayDto } from './dto/calendar-work-day.dto';
import { ImportCalendarScheduleDto } from './dto/import-calendar-schedule.dto';
import { mergeScheduleDays } from './calendar-schedule-import';

const WORK_DAYS_INCLUDE = {
  workDays: true,
  createdByEmployee: { select: { FullName: true } },
  modifiedByEmployee: { select: { FullName: true } },
} as const;

@Injectable()
export class CalendarService {
  constructor(private readonly prisma: PrismaService) {}

  // Le DTO valide chaque champ isolément (class-validator n'a pas de contexte
  // inter-champs facile ici) — la coherence Start/End/Break se verifie donc
  // manuellement avant persistance, sinon un jour "fin avant debut" passait
  // silencieusement (voir test #03 du plan de tests).
  private validateWorkDays(workDays?: CalendarWorkDayDto[]) {
    if (!workDays) return;
    for (const day of workDays) {
      if (!day.IsEnabled) continue;
      if (day.StartTime && day.EndTime && day.EndTime <= day.StartTime) {
        throw new BadRequestException(
          `${day.DayOfWeek} : l'heure de fin doit être après l'heure de début`,
        );
      }
      if (day.BreakEnabled && day.BreakStartTime && day.BreakEndTime) {
        if (day.BreakEndTime <= day.BreakStartTime) {
          throw new BadRequestException(`${day.DayOfWeek} : la pause doit finir après avoir commencé`);
        }
        if (day.StartTime && day.BreakStartTime < day.StartTime) {
          throw new BadRequestException(
            `${day.DayOfWeek} : la pause ne peut pas commencer avant l'heure de début`,
          );
        }
        if (day.EndTime && day.BreakEndTime > day.EndTime) {
          throw new BadRequestException(`${day.DayOfWeek} : la pause ne peut pas finir après l'heure de fin`);
        }
      }
    }
  }

  // Un calendrier a une seule portee : global (defaut), categorie ou employe.
  private validateScope(dto: { IsDefault?: boolean; EmployeeCategoryId?: string | null; EmployeeId?: string | null }) {
    const scopes = [dto.IsDefault ? 'defaut' : null, dto.EmployeeCategoryId, dto.EmployeeId].filter(Boolean);
    if (scopes.length > 1) {
      throw new BadRequestException(
        'Un calendrier est soit le calendrier par défaut, soit celui d\'une catégorie, soit celui d\'un employé',
      );
    }
  }

  // Un employe n'a jamais plus d'un calendrier dedie (pas de contrainte SQL,
  // voir schema.prisma).
  private async assertEmployeeFree(employeeId: string | null | undefined, exceptCalendarId?: string) {
    if (!employeeId) return;
    const taken = await this.prisma.calendar.findFirst({
      where: { EmployeeId: employeeId, ...(exceptCalendarId ? { Id: { not: exceptCalendarId } } : {}) },
      select: { Id: true },
    });
    if (taken) throw new BadRequestException('Cet employé a déjà un calendrier dédié');
  }

  async create(dto: CreateCalendarDto, createdBy: string) {
    this.validateWorkDays(dto.WorkDays);
    this.validateScope(dto);
    await this.assertEmployeeFree(dto.EmployeeId);
    return this.prisma.$transaction(async (tx) => {
      // Un seul calendrier par defaut a la fois — sans ca, en creer un second
      // avec IsDefault:true laisserait deux lignes a true en base et
      // findDefault() resterait bloque sur le premier trouve.
      if (dto.IsDefault) {
        await tx.calendar.updateMany({ where: { IsDefault: true }, data: { IsDefault: false } });
      }
      return tx.calendar.create({
        data: {
          Name: dto.Name,
          IsDefault: dto.IsDefault ?? false,
          EmployeeCategoryId: dto.EmployeeCategoryId,
          EmployeeId: dto.EmployeeId,
          CreatedBy: createdBy,
          workDays: { create: dto.WorkDays },
        },
        include: WORK_DAYS_INCLUDE,
      });
    });
  }

  findAll() {
    return this.prisma.calendar.findMany({ include: WORK_DAYS_INCLUDE });
  }

  async findDefault() {
    const calendar = await this.prisma.calendar.findFirst({
      where: { IsDefault: true },
      include: WORK_DAYS_INCLUDE,
    });
    if (!calendar) {
      throw new NotFoundException("Aucun calendrier par défaut n'est configuré");
    }
    return calendar;
  }

  // null (pas d'exception) si la categorie n'a pas de calendrier dedie —
  // c'est a l'appelant de decider du repli (voir resolveForEmployee).
  findByCategory(employeeCategoryId: string) {
    return this.prisma.calendar.findFirst({
      where: { EmployeeCategoryId: employeeCategoryId },
      include: WORK_DAYS_INCLUDE,
    });
  }

  findByEmployee(employeeId: string) {
    return this.prisma.calendar.findFirst({
      where: { EmployeeId: employeeId },
      include: WORK_DAYS_INCLUDE,
    });
  }

  // Calendrier applicable a un employe : le sien s'il en a un (module Temps de
  // travail), sinon celui de sa categorie, sinon le calendrier global par
  // defaut. Les conges (LeaveRequestService) restent sur categorie > global.
  async resolveForEmployee(employeeId: string) {
    const own = await this.findByEmployee(employeeId);
    if (own) return own;
    const employee = await this.prisma.employee.findUnique({
      where: { Id: employeeId },
      select: { EmployeeCategoryId: true },
    });
    if (employee?.EmployeeCategoryId) {
      const byCategory = await this.findByCategory(employee.EmployeeCategoryId);
      if (byCategory) return byCategory;
    }
    return this.findDefault();
  }

  async findOne(id: string) {
    const calendar = await this.prisma.calendar.findUnique({
      where: { Id: id },
      include: WORK_DAYS_INCLUDE,
    });
    if (!calendar) {
      throw new NotFoundException(`Calendrier ${id} introuvable`);
    }
    return calendar;
  }

  async update(id: string, dto: UpdateCalendarDto, modifiedBy: string) {
    const existing = await this.findOne(id);
    this.validateWorkDays(dto.WorkDays);
    // Portee finale apres modification (un champ absent garde sa valeur actuelle).
    this.validateScope({
      IsDefault: dto.IsDefault ?? existing.IsDefault,
      EmployeeCategoryId: dto.EmployeeCategoryId !== undefined ? dto.EmployeeCategoryId : existing.EmployeeCategoryId,
      EmployeeId: dto.EmployeeId !== undefined ? dto.EmployeeId : existing.EmployeeId,
    });
    await this.assertEmployeeFree(dto.EmployeeId, id);
    return this.prisma.$transaction(async (tx) => {
      if (dto.IsDefault) {
        await tx.calendar.updateMany({
          where: { IsDefault: true, Id: { not: id } },
          data: { IsDefault: false },
        });
      }
      await tx.calendar.update({
        where: { Id: id },
        data: {
          Name: dto.Name,
          IsDefault: dto.IsDefault,
          EmployeeCategoryId: dto.EmployeeCategoryId,
          EmployeeId: dto.EmployeeId,
          ModifiedBy: modifiedBy,
          ModifiedAt: new Date(),
        },
      });

      if (dto.WorkDays) {
        // The frontend always sends the full 7-day week — replace atomically
        // rather than trying to diff/upsert individual days.
        await tx.calendarWorkDay.deleteMany({ where: { CalendarId: id } });
        await tx.calendarWorkDay.createMany({
          data: dto.WorkDays.map((day) => ({ ...day, CalendarId: id })),
        });
      }

      return tx.calendar.findUniqueOrThrow({ where: { Id: id }, include: WORK_DAYS_INCLUDE });
    });
  }

  // Import d'un horaire (jours, heures, pause) pour le calendrier global, celui d'une
  // categorie ou celui d'un employe. Le calendrier est cree s'il n'existe pas (les jours
  // non indiques sont alors des jours de repos) ; sinon seuls les jours indiques changent.
  async importSchedule(dto: ImportCalendarScheduleDto, actorId: string) {
    let calendar: Awaited<ReturnType<CalendarService['findOne']>> | null = null;
    let label = '';
    let targetId: string | undefined;
    if (dto.Scope === 'global') {
      calendar = await this.prisma.calendar.findFirst({ where: { IsDefault: true }, include: WORK_DAYS_INCLUDE });
      if (!calendar) throw new BadRequestException("Aucun calendrier par défaut n'est configuré");
    } else {
      const code = dto.TargetCode?.trim();
      if (!code) throw new BadRequestException(dto.Scope === 'category' ? 'Indiquez le code de la catégorie' : "Indiquez le matricule de l'employé");
      if (dto.Scope === 'category') {
        const category = await this.prisma.employeeCategory.findFirst({ where: { Code: code }, select: { Id: true, Name: true } });
        if (!category) throw new NotFoundException(`Aucune catégorie avec le code « ${code} »`);
        targetId = category.Id;
        label = category.Name;
        calendar = await this.findByCategory(category.Id);
      } else {
        const employee = await this.prisma.employee.findFirst({ where: { EmployeeNumber: code, IsDeleted: false }, select: { Id: true, FullName: true } });
        if (!employee) throw new NotFoundException(`Aucun employé avec le matricule « ${code} »`);
        targetId = employee.Id;
        label = employee.FullName;
        calendar = await this.findByEmployee(employee.Id);
      }
    }

    const workDays = mergeScheduleDays(calendar?.workDays ?? [], dto);
    if (calendar) {
      return this.update(calendar.Id, { WorkDays: workDays as unknown as CalendarWorkDayDto[] }, actorId);
    }
    return this.create(
      {
        Name: `Horaires ${label}`.slice(0, 100),
        EmployeeCategoryId: dto.Scope === 'category' ? targetId : undefined,
        EmployeeId: dto.Scope === 'employee' ? targetId : undefined,
        WorkDays: workDays as unknown as CalendarWorkDayDto[],
      },
      actorId,
    );
  }

  async remove(id: string) {
    const calendar = await this.findOne(id);
    if (calendar.IsDefault) {
      throw new BadRequestException(
        'Le calendrier par défaut ne peut pas être supprimé : définissez-en un autre comme défaut d\'abord',
      );
    }
    // CalendarWorkDay.calendar est onDelete: NoAction (contrainte SQL Server,
    // voir en-tete du schema) — supprimer le calendrier sans d'abord vider
    // ses lignes de jours provoque une violation de FK.
    return this.prisma.$transaction([
      this.prisma.calendarWorkDay.deleteMany({ where: { CalendarId: id } }),
      this.prisma.calendar.delete({ where: { Id: id } }),
    ]);
  }
}

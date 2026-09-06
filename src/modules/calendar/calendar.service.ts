import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateCalendarDto } from './dto/create-calendar.dto';
import { UpdateCalendarDto } from './dto/update-calendar.dto';
import { CalendarWorkDayDto } from './dto/calendar-work-day.dto';

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

  async create(dto: CreateCalendarDto, createdBy: string) {
    this.validateWorkDays(dto.WorkDays);
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

  // Calendrier applicable a un employe : celui de sa categorie s'il en a un
  // de dedie, sinon le calendrier global par defaut (decision du 04/08 —
  // calendrier par categorie uniquement, pas de surcharge par employe).
  async resolveForEmployee(employeeId: string) {
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
    await this.findOne(id);
    this.validateWorkDays(dto.WorkDays);
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

  async remove(id: string) {
    const calendar = await this.findOne(id);
    if (calendar.IsDefault) {
      throw new BadRequestException(
        'Le calendrier par défaut ne peut pas être supprimé — définissez-en un autre comme défaut d\'abord',
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

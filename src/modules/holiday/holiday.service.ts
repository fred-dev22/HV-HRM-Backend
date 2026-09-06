import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '../../../prisma/generated/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateHolidayDto } from './dto/create-holiday.dto';
import { UpdateHolidayDto } from './dto/update-holiday.dto';
import { bulkImport } from '../../common/utils/bulk-import.util';

@Injectable()
export class HolidayService {
  constructor(private readonly prisma: PrismaService) {}

  create(dto: CreateHolidayDto, createdBy: string) {
    return this.prisma.holiday.create({
      data: { ...dto, CreatedBy: createdBy },
    });
  }

  // Import CSV (Lot D) — voir common/utils/bulk-import.util.ts.
  bulkCreate(items: unknown[], createdBy: string) {
    return bulkImport(items, CreateHolidayDto, (dto) =>
      this.create(dto, createdBy),
    );
  }

  findAll() {
    return this.prisma.holiday.findMany();
  }

  // IsRecurring holidays apply every year (only the month/day is meaningful —
  // the stored Date is remapped onto the requested year). Non-recurring
  // holidays only apply to the specific year of their stored Date.
  // organizationUnitId/gender/isExpatriate, quand fournis, restreignent aux
  // jours feries dont le ciblage correspond OU qui ne ciblent rien sur ce
  // critere (AppliesTo*/OrganizationUnitId nul = s'applique a tous) — meme
  // logique que isEligible (eligibility.util.ts), exprimee ici directement en
  // clause Prisma plutot qu'en filtrage memoire, faute d'employe complet a
  // passer (voir LeaveTransactionService.getBalances pour ce cas-la).
  async findForYear(
    year: number,
    organizationUnitId?: string,
    gender?: string,
    isExpatriate?: boolean,
  ) {
    const conditions: Prisma.HolidayWhereInput[] = [];
    if (organizationUnitId) {
      conditions.push({
        OR: [
          { OrganizationUnitId: null },
          { OrganizationUnitId: organizationUnitId },
        ],
      });
    }
    if (gender) {
      conditions.push({
        OR: [{ AppliesToGender: null }, { AppliesToGender: gender }],
      });
    }
    if (isExpatriate !== undefined) {
      conditions.push({
        OR: [
          { AppliesToExpatriate: null },
          { AppliesToExpatriate: isExpatriate },
        ],
      });
    }

    const holidays = await this.prisma.holiday.findMany({
      where: conditions.length > 0 ? { AND: conditions } : undefined,
    });

    return holidays
      .filter((h) => h.IsRecurring || h.Date.getUTCFullYear() === year)
      .map((h) =>
        h.IsRecurring
          ? {
              ...h,
              Date: new Date(
                Date.UTC(year, h.Date.getUTCMonth(), h.Date.getUTCDate()),
              ),
            }
          : h,
      );
  }

  async findOne(id: string) {
    const holiday = await this.prisma.holiday.findUnique({ where: { Id: id } });
    if (!holiday) {
      throw new NotFoundException(`Jour férié ${id} introuvable`);
    }
    return holiday;
  }

  async update(id: string, dto: UpdateHolidayDto) {
    await this.findOne(id);
    return this.prisma.holiday.update({ where: { Id: id }, data: dto });
  }

  async remove(id: string) {
    await this.findOne(id);
    return this.prisma.holiday.delete({ where: { Id: id } });
  }
}

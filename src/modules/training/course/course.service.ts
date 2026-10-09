import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { nextReferenceCode, withReferenceCodeRetry } from '../../recruitment/recruitment.util';
import { TRAINING_REFERENCE_PREFIXES, toDay } from '../training.constants';
import { CreateCourseDto, UpdateCourseDto } from '../dto/training.dto';

// Les sessions annulees ne comptent pas dans "Sessions" du catalogue.
const INCLUDE = {
  provider: { select: { Id: true, Name: true } },
  sessions: { where: { IsDeleted: false, Status: { not: 'Cancelled' } }, select: { Id: true } },
} as const;

type CourseRow = {
  Id: string;
  ReferenceCode: string;
  Title: string;
  Category: string;
  Description: string;
  DurationHours: number;
  MaxParticipants: number;
  ProviderId: string | null;
  Status: string;
  BudgetAllocated: unknown;
  BudgetUsed: unknown;
  CreatedAt: Date;
  provider?: { Id: string; Name: string } | null;
  sessions?: { Id: string }[];
};

export function shapeCourse(row: CourseRow) {
  return {
    id: row.Id,
    referenceCode: row.ReferenceCode,
    title: row.Title,
    category: row.Category,
    description: row.Description,
    durationHours: row.DurationHours,
    maxParticipants: row.MaxParticipants,
    providerId: row.ProviderId ?? undefined,
    providerName: row.provider?.Name ?? undefined,
    status: row.Status,
    budgetAllocated: Number(row.BudgetAllocated),
    budgetUsed: Number(row.BudgetUsed),
    sessionsCount: row.sessions?.length ?? 0,
    createdAt: toDay(row.CreatedAt) as string,
  };
}

@Injectable()
export class CourseService {
  constructor(private readonly prisma: PrismaService) {}

  private async findRaw(id: string) {
    const row = await this.prisma.trainingCourse.findUnique({ where: { Id: id } });
    if (!row || row.IsDeleted) {
      throw new NotFoundException(`Formation ${id} introuvable`);
    }
    return row;
  }

  private async assertProviderUsable(providerId: string) {
    const provider = await this.prisma.trainingProvider.findUnique({ where: { Id: providerId } });
    if (!provider || provider.IsDeleted) {
      throw new NotFoundException(`Prestataire ${providerId} introuvable`);
    }
  }

  async findAll() {
    const rows = await this.prisma.trainingCourse.findMany({
      where: { IsDeleted: false },
      include: INCLUDE,
      orderBy: { CreatedAt: 'desc' },
    });
    return rows.map(shapeCourse);
  }

  async findOne(id: string) {
    const row = await this.prisma.trainingCourse.findUnique({ where: { Id: id }, include: INCLUDE });
    if (!row || row.IsDeleted) {
      throw new NotFoundException(`Formation ${id} introuvable`);
    }
    return shapeCourse(row);
  }

  async create(dto: CreateCourseDto, employeeId: string) {
    if (dto.providerId) await this.assertProviderUsable(dto.providerId);
    const row = await withReferenceCodeRetry(async () =>
      this.prisma.trainingCourse.create({
        data: {
          ReferenceCode: await nextReferenceCode(TRAINING_REFERENCE_PREFIXES.course, (p) =>
            this.prisma.trainingCourse.findMany({ where: { ReferenceCode: { startsWith: p } }, select: { ReferenceCode: true } }),
          ),
          Title: dto.title.trim(),
          Category: dto.category.trim(),
          Description: dto.description.trim(),
          DurationHours: dto.durationHours,
          MaxParticipants: dto.maxParticipants,
          ProviderId: dto.providerId,
          Status: 'InPreparation',
          BudgetAllocated: dto.budgetAllocated,
          CreatedBy: employeeId,
        },
        include: INCLUDE,
      }),
    );
    return shapeCourse(row);
  }

  async update(id: string, dto: UpdateCourseDto, employeeId: string) {
    await this.findRaw(id);
    if (dto.providerId) await this.assertProviderUsable(dto.providerId);
    if (dto.maxParticipants !== undefined) {
      // On ne peut pas descendre l'effectif maximum sous la capacite d'une
      // session encore planifiee.
      const biggest = await this.prisma.trainingSession.findFirst({
        where: { CourseId: id, IsDeleted: false, Status: 'Scheduled', Capacity: { gt: dto.maxParticipants } },
        select: { ReferenceCode: true, Capacity: true },
      });
      if (biggest) {
        throw new BadRequestException(
          `La session ${biggest.ReferenceCode} a une capacité de ${biggest.Capacity}, supérieure à l'effectif maximum demandé`,
        );
      }
    }
    const row = await this.prisma.trainingCourse.update({
      where: { Id: id },
      data: {
        ...(dto.title !== undefined && { Title: dto.title.trim() }),
        ...(dto.category !== undefined && { Category: dto.category.trim() }),
        ...(dto.description !== undefined && { Description: dto.description.trim() }),
        ...(dto.durationHours !== undefined && { DurationHours: dto.durationHours }),
        ...(dto.maxParticipants !== undefined && { MaxParticipants: dto.maxParticipants }),
        ...(dto.providerId !== undefined && { ProviderId: dto.providerId }),
        ...(dto.budgetAllocated !== undefined && { BudgetAllocated: dto.budgetAllocated }),
        ...(dto.status !== undefined && { Status: dto.status }),
        ModifiedBy: employeeId,
        ModifiedAt: new Date(),
      },
      include: INCLUDE,
    });
    return shapeCourse(row);
  }

  // Suppression logique : refusee tant qu'une session non annulee existe.
  async remove(id: string, employeeId: string) {
    await this.findRaw(id);
    const sessions = await this.prisma.trainingSession.count({
      where: { CourseId: id, IsDeleted: false, Status: { not: 'Cancelled' } },
    });
    if (sessions > 0) {
      throw new ConflictException(
        `Cette formation a encore ${sessions} session(s) : annulez-les d'abord`,
      );
    }
    await this.prisma.trainingCourse.update({
      where: { Id: id },
      data: { IsDeleted: true, DeletedBy: employeeId, DeletedAt: new Date() },
    });
    return { ok: true };
  }
}

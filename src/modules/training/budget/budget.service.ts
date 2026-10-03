import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { CreateBudgetLineDto } from '../dto/training.dto';

type BudgetRow = {
  Id: string;
  Year: number;
  EntityName: string;
  CourseTitle: string | null;
  Allocated: unknown;
  Used: unknown;
  RequestStatus: string;
  Comment: string | null;
};

export function shapeBudgetLine(row: BudgetRow) {
  return {
    id: row.Id,
    year: row.Year,
    entityName: row.EntityName,
    courseTitle: row.CourseTitle ?? undefined,
    allocated: Number(row.Allocated),
    used: Number(row.Used),
    requestStatus: row.RequestStatus,
    comment: row.Comment ?? undefined,
  };
}

@Injectable()
export class BudgetService {
  constructor(private readonly prisma: PrismaService) {}

  private async findRaw(id: string) {
    const row = await this.prisma.trainingBudgetLine.findUnique({ where: { Id: id } });
    if (!row || row.IsDeleted) {
      throw new NotFoundException(`Ligne de budget ${id} introuvable`);
    }
    return row;
  }

  async findAll() {
    const rows = await this.prisma.trainingBudgetLine.findMany({
      where: { IsDeleted: false },
      orderBy: [{ Year: 'desc' }, { CreatedAt: 'desc' }],
    });
    return rows.map(shapeBudgetLine);
  }

  async create(dto: CreateBudgetLineDto, employeeId: string) {
    const row = await this.prisma.trainingBudgetLine.create({
      data: {
        Year: dto.year,
        EntityName: dto.entityName.trim(),
        CourseTitle: dto.courseTitle?.trim() || null,
        Allocated: dto.allocated,
        Comment: dto.comment?.trim() || null,
        RequestStatus: 'Pending',
        CreatedBy: employeeId,
      },
    });
    return shapeBudgetLine(row);
  }

  // Seule une demande en attente peut etre decidee : approuver une demande
  // deja refusee (ou l'inverse) est refuse au lieu d'ecraser la decision.
  private async decide(id: string, status: 'Approved' | 'Rejected', employeeId: string) {
    const row = await this.findRaw(id);
    if (row.RequestStatus !== 'Pending') {
      throw new BadRequestException(`Cette demande est déjà décidée (statut "${row.RequestStatus}")`);
    }
    const updated = await this.prisma.trainingBudgetLine.update({
      where: { Id: id },
      data: { RequestStatus: status, ModifiedBy: employeeId, ModifiedAt: new Date() },
    });
    return shapeBudgetLine(updated);
  }

  approve(id: string, employeeId: string) {
    return this.decide(id, 'Approved', employeeId);
  }

  reject(id: string, employeeId: string) {
    return this.decide(id, 'Rejected', employeeId);
  }
}

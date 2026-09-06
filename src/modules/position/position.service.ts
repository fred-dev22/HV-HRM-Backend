import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreatePositionDto } from './dto/create-position.dto';
import { UpdatePositionDto } from './dto/update-position.dto';
import { bulkImport } from '../../common/utils/bulk-import.util';

@Injectable()
export class PositionService {
  constructor(private readonly prisma: PrismaService) {}

  // occupiedCount jamais stocke — toujours recompte depuis Employee.PositionId
  // (voir schema.prisma) pour eviter tout desync avec les affectations reelles.
  private withOccupiedCount() {
    return { include: { _count: { select: { employees: true } } } } as const;
  }

  private mapCount<T extends { _count: { employees: number } }>(position: T) {
    const { _count, ...rest } = position;
    return { ...rest, OccupiedCount: _count.employees };
  }

  async create(dto: CreatePositionDto, createdBy: string) {
    const position = await this.prisma.position.create({
      data: { ...dto, CreatedBy: createdBy },
      ...this.withOccupiedCount(),
    });
    return this.mapCount(position);
  }

  // Import CSV (Lot D) — voir common/utils/bulk-import.util.ts.
  bulkCreate(items: unknown[], createdBy: string) {
    return bulkImport(items, CreatePositionDto, (dto) => this.create(dto, createdBy));
  }

  async findAll() {
    const positions = await this.prisma.position.findMany(this.withOccupiedCount());
    return positions.map((p) => this.mapCount(p));
  }

  async findByUnit(organizationUnitId: string) {
    const positions = await this.prisma.position.findMany({
      where: { OrganizationUnitId: organizationUnitId },
      ...this.withOccupiedCount(),
    });
    return positions.map((p) => this.mapCount(p));
  }

  // Postes ayant encore au moins un siege libre (Capacity > sieges occupes).
  async findAvailable() {
    const all = await this.findAll();
    return all.filter((p) => p.OccupiedCount < p.Capacity);
  }

  async findOne(id: string) {
    const position = await this.prisma.position.findUnique({
      where: { Id: id },
      ...this.withOccupiedCount(),
    });
    if (!position) {
      throw new NotFoundException(`Poste ${id} introuvable`);
    }
    return this.mapCount(position);
  }

  async update(id: string, dto: UpdatePositionDto, modifiedBy: string) {
    await this.findOne(id);
    const position = await this.prisma.position.update({
      where: { Id: id },
      data: { ...dto, ModifiedBy: modifiedBy, ModifiedAt: new Date() },
      ...this.withOccupiedCount(),
    });
    return this.mapCount(position);
  }

  async remove(id: string) {
    await this.findOne(id);
    return this.prisma.position.delete({ where: { Id: id } });
  }
}

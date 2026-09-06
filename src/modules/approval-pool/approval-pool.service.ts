import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateApprovalPoolDto } from './dto/create-approval-pool.dto';
import { UpdateApprovalPoolDto } from './dto/update-approval-pool.dto';

@Injectable()
export class ApprovalPoolService {
  constructor(private readonly prisma: PrismaService) {}

  create(dto: CreateApprovalPoolDto, createdBy: string) {
    return this.prisma.approvalPool.create({ data: { ...dto, CreatedBy: createdBy } });
  }

  findAll() {
    return this.prisma.approvalPool.findMany({ include: { members: true } });
  }

  findByUnit(unitId: string) {
    return this.prisma.approvalPool.findMany({
      where: { OrganizationUnitId: unitId },
      include: { members: true },
    });
  }

  async findOne(id: string) {
    const pool = await this.prisma.approvalPool.findUnique({
      where: { Id: id },
      include: { members: true },
    });
    if (!pool) {
      throw new NotFoundException(`Pool d'approbation ${id} introuvable`);
    }
    return pool;
  }

  async update(id: string, dto: UpdateApprovalPoolDto, modifiedBy: string) {
    await this.findOne(id);
    return this.prisma.approvalPool.update({
      where: { Id: id },
      data: { ...dto, ModifiedBy: modifiedBy, ModifiedAt: new Date() },
    });
  }

  async remove(id: string) {
    await this.findOne(id);
    return this.prisma.approvalPool.delete({ where: { Id: id } });
  }

  // Règle métier : si l'entité n'a pas de pool actif pour ce type de demande,
  // remonte via ParentId jusqu'à en trouver un (ou plus de parent). Utilisé
  // par LeaveRequest/MissionOrder/ExpenseReport pour déterminer le pool
  // applicable à la création d'une demande (voir Domaine 3+).
  async findApplicablePool(organizationUnitId: string, objectType: string) {
    let currentUnitId: string | null = organizationUnitId;

    while (currentUnitId) {
      const pool = await this.prisma.approvalPool.findFirst({
        where: { OrganizationUnitId: currentUnitId, ObjectType: objectType, IsActive: true },
        include: { members: true },
      });
      if (pool) return pool;

      const unit = await this.prisma.organizationUnit.findUnique({
        where: { Id: currentUnitId },
        select: { ParentId: true },
      });
      currentUnitId = unit?.ParentId ?? null;
    }

    return null;
  }
}

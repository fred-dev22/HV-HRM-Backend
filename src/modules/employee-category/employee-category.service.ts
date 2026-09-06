import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '../../../prisma/generated/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateEmployeeCategoryDto } from './dto/create-employee-category.dto';
import { UpdateEmployeeCategoryDto } from './dto/update-employee-category.dto';
import { AddCategoryPermissionDto } from './dto/add-category-permission.dto';
import { bulkImport } from '../../common/utils/bulk-import.util';

@Injectable()
export class EmployeeCategoryService {
  constructor(private readonly prisma: PrismaService) {}

  private include() {
    return {
      categoryPermissions: { include: { permission: true } },
      // Plan de tests #15 : permettre de voir avant coup combien d'employés
      // sont rattachés à une catégorie (la suppression est déjà bloquée avec
      // un message clair si ce nombre est > 0, voir remove() ci-dessous).
      _count: { select: { employees: { where: { IsDeleted: false, IsSystem: false } } } },
    };
  }

  create(dto: CreateEmployeeCategoryDto, createdBy: string) {
    return this.prisma.employeeCategory.create({ data: { ...dto, CreatedBy: createdBy } });
  }

  // Import CSV (Lot D) — voir common/utils/bulk-import.util.ts.
  bulkCreate(items: unknown[], createdBy: string) {
    return bulkImport(items, CreateEmployeeCategoryDto, (dto) => this.create(dto, createdBy));
  }

  findAll() {
    return this.prisma.employeeCategory.findMany({ include: this.include() });
  }

  async findOne(id: string) {
    const category = await this.prisma.employeeCategory.findUnique({
      where: { Id: id },
      include: this.include(),
    });
    if (!category) {
      throw new NotFoundException(`Catégorie d'employé ${id} introuvable`);
    }
    return category;
  }

  async update(id: string, dto: UpdateEmployeeCategoryDto, modifiedBy: string) {
    await this.findOne(id);
    return this.prisma.employeeCategory.update({
      where: { Id: id },
      data: { ...dto, ModifiedBy: modifiedBy, ModifiedAt: new Date() },
      include: this.include(),
    });
  }

  async remove(id: string) {
    await this.findOne(id);
    try {
      return await this.prisma.employeeCategory.delete({ where: { Id: id } });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2003') {
        throw new ConflictException(
          'Cette catégorie est encore utilisée par au moins un employé ou un compte utilisateur et ne peut pas être supprimée — réaffectez-les à une autre catégorie avant de la supprimer.',
        );
      }
      throw err;
    }
  }

  // Ce gabarit (CategoryPermission) n'est JAMAIS relu pour les comptes déjà
  // créés — voir UserService.create (copie unique à la création du compte)
  // et le bandeau d'avertissement sur EmployeeCategoriesConfigView.vue.
  async addPermission(categoryId: string, dto: AddCategoryPermissionDto, createdBy: string) {
    await this.findOne(categoryId);
    const permission = await this.prisma.permission.findUnique({ where: { Id: dto.PermissionId } });
    if (!permission) {
      throw new NotFoundException(`Permission ${dto.PermissionId} introuvable`);
    }
    await this.prisma.categoryPermission.upsert({
      where: {
        EmployeeCategoryId_PermissionId: { EmployeeCategoryId: categoryId, PermissionId: dto.PermissionId },
      },
      update: {},
      create: { EmployeeCategoryId: categoryId, PermissionId: dto.PermissionId, CreatedBy: createdBy },
    });
    return this.findOne(categoryId);
  }

  async removePermission(categoryId: string, permissionId: string) {
    await this.findOne(categoryId);
    await this.prisma.categoryPermission.deleteMany({
      where: { EmployeeCategoryId: categoryId, PermissionId: permissionId },
    });
    return this.findOne(categoryId);
  }
}

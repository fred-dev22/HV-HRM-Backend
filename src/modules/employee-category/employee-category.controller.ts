import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { EmployeeCategoryService } from './employee-category.service';
import { CreateEmployeeCategoryDto } from './dto/create-employee-category.dto';
import { UpdateEmployeeCategoryDto } from './dto/update-employee-category.dto';
import { AddCategoryPermissionDto } from './dto/add-category-permission.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { BulkImportDto } from '../../common/dto/bulk-import.dto';

@Controller('employee-categories')
export class EmployeeCategoryController {
  constructor(private readonly service: EmployeeCategoryService) {}

  @Post()
  @RequirePermission('CONFIG_CATEGORIES_EMPLOYE')
  create(@Body() dto: CreateEmployeeCategoryDto, @CurrentUser('employeeId') employeeId: string) {
    return this.service.create(dto, employeeId);
  }

  // Doit rester avant ':id' — sinon Nest matcherait POST /employee-categories/bulk.
  @Post('bulk')
  @RequirePermission('CONFIG_CATEGORIES_EMPLOYE')
  bulkCreate(@Body() dto: BulkImportDto, @CurrentUser('employeeId') employeeId: string) {
    return this.service.bulkCreate(dto.items, employeeId);
  }

  @Get()
  findAll() {
    return this.service.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Patch(':id')
  @RequirePermission('CONFIG_CATEGORIES_EMPLOYE')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateEmployeeCategoryDto,
    @CurrentUser('employeeId') employeeId: string,
  ) {
    return this.service.update(id, dto, employeeId);
  }

  @Delete(':id')
  @RequirePermission('CONFIG_CATEGORIES_EMPLOYE')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }

  // Qui peut donner tel droit à toute une catégorie est plus sensible que la
  // simple gestion Code/Libellé — permission dédiée (voir prisma/seed.ts,
  // uniquement Directeur RH par défaut).
  @Post(':id/permissions')
  @RequirePermission('CATEGORIE_GERER')
  addPermission(
    @Param('id') id: string,
    @Body() dto: AddCategoryPermissionDto,
    @CurrentUser('employeeId') employeeId: string,
  ) {
    return this.service.addPermission(id, dto, employeeId);
  }

  @Delete(':id/permissions/:permissionId')
  @RequirePermission('CATEGORIE_GERER')
  removePermission(@Param('id') id: string, @Param('permissionId') permissionId: string) {
    return this.service.removePermission(id, permissionId);
  }
}

import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { OrganizationUnitService } from './organization-unit.service';
import { CreateOrganizationUnitDto } from './dto/create-organization-unit.dto';
import { UpdateOrganizationUnitDto } from './dto/update-organization-unit.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { BulkImportDto } from '../../common/dto/bulk-import.dto';

@Controller('organization-units')
export class OrganizationUnitController {
  constructor(private readonly service: OrganizationUnitService) {}

  @Post()
  @RequirePermission('ENTITE_CREER')
  create(@Body() dto: CreateOrganizationUnitDto, @CurrentUser('employeeId') employeeId: string) {
    return this.service.create(dto, employeeId);
  }

  // Doit rester avant ':id' — sinon Nest matcherait POST /organization-units/bulk.
  @Post('bulk')
  @RequirePermission('ENTITE_CREER')
  bulkCreate(@Body() dto: BulkImportDto, @CurrentUser('employeeId') employeeId: string) {
    return this.service.bulkCreate(dto.items, employeeId);
  }

  @Get()
  @RequirePermission('ENTITE_VOIR')
  findAll() {
    return this.service.findAll();
  }

  // Must be declared before ':id' — otherwise Express/Nest would match
  // GET /organization-units/tree as findOne('tree').
  @Get('tree')
  @RequirePermission('ENTITE_VOIR')
  findTree() {
    return this.service.findTree();
  }

  @Get(':id')
  @RequirePermission('ENTITE_VOIR')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Get(':id/children')
  @RequirePermission('ENTITE_VOIR')
  findChildren(@Param('id') id: string) {
    return this.service.findChildren(id);
  }

  @Patch(':id')
  @RequirePermission('ENTITE_MODIFIER')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateOrganizationUnitDto,
    @CurrentUser('employeeId') employeeId: string,
  ) {
    return this.service.update(id, dto, employeeId);
  }

  @Post(':id/submit')
  @RequirePermission('ENTITE_SOUMETTRE')
  submit(@Param('id') id: string, @CurrentUser('employeeId') employeeId: string) {
    return this.service.submit(id, employeeId);
  }

  @Post(':id/approve')
  @RequirePermission('ENTITE_APPROUVER')
  approve(@Param('id') id: string, @CurrentUser('employeeId') employeeId: string) {
    return this.service.approve(id, employeeId);
  }

  @Post(':id/reject')
  @RequirePermission('ENTITE_APPROUVER')
  reject(@Param('id') id: string, @CurrentUser('employeeId') employeeId: string) {
    return this.service.reject(id, employeeId);
  }

  // Suppression definitive (Lot I) — voir doc de service.softDelete().
  @Delete(':id/permanent')
  @RequirePermission('ENTITE_SUPPRIMER')
  softDelete(@Param('id') id: string, @CurrentUser('employeeId') employeeId: string) {
    return this.service.softDelete(id, employeeId);
  }
}

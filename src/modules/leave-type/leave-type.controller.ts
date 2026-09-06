import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { LeaveTypeService } from './leave-type.service';
import { CreateLeaveTypeDto } from './dto/create-leave-type.dto';
import { UpdateLeaveTypeDto } from './dto/update-leave-type.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { BulkImportDto } from '../../common/dto/bulk-import.dto';

@Controller('leave-types')
export class LeaveTypeController {
  constructor(private readonly service: LeaveTypeService) {}

  @Post()
  @RequirePermission('CONFIG_TYPES_CONGE')
  create(@Body() dto: CreateLeaveTypeDto, @CurrentUser('employeeId') employeeId: string) {
    return this.service.create(dto, employeeId);
  }

  // Doit rester avant ':id' — sinon Nest matcherait POST /leave-types/bulk.
  @Post('bulk')
  @RequirePermission('CONFIG_TYPES_CONGE')
  bulkCreate(@Body() dto: BulkImportDto, @CurrentUser('employeeId') employeeId: string) {
    return this.service.bulkCreate(dto.items, employeeId);
  }

  @Get()
  findAll() {
    return this.service.findAll();
  }

  @Get('active')
  findActive() {
    return this.service.findActive();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Patch(':id')
  @RequirePermission('CONFIG_TYPES_CONGE')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateLeaveTypeDto,
    @CurrentUser('employeeId') employeeId: string,
  ) {
    return this.service.update(id, dto, employeeId);
  }

  @Patch(':id/toggle')
  @RequirePermission('CONFIG_TYPES_CONGE')
  toggleActive(@Param('id') id: string, @CurrentUser('employeeId') employeeId: string) {
    return this.service.toggleActive(id, employeeId);
  }

  @Delete(':id')
  @RequirePermission('CONFIG_TYPES_CONGE')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}

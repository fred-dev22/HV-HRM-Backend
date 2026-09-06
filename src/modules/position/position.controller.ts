import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { PositionService } from './position.service';
import { CreatePositionDto } from './dto/create-position.dto';
import { UpdatePositionDto } from './dto/update-position.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { BulkImportDto } from '../../common/dto/bulk-import.dto';

@Controller('positions')
export class PositionController {
  constructor(private readonly service: PositionService) {}

  @Post()
  @RequirePermission('CONFIG_METIERS_POSTES')
  create(@Body() dto: CreatePositionDto, @CurrentUser('employeeId') employeeId: string) {
    return this.service.create(dto, employeeId);
  }

  @Post('bulk')
  @RequirePermission('CONFIG_METIERS_POSTES')
  bulkCreate(@Body() dto: BulkImportDto, @CurrentUser('employeeId') employeeId: string) {
    return this.service.bulkCreate(dto.items, employeeId);
  }

  @Get()
  findAll() {
    return this.service.findAll();
  }

  @Get('available')
  findAvailable() {
    return this.service.findAvailable();
  }

  @Get('by-unit/:unitId')
  findByUnit(@Param('unitId') unitId: string) {
    return this.service.findByUnit(unitId);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Patch(':id')
  @RequirePermission('CONFIG_METIERS_POSTES')
  update(
    @Param('id') id: string,
    @Body() dto: UpdatePositionDto,
    @CurrentUser('employeeId') employeeId: string,
  ) {
    return this.service.update(id, dto, employeeId);
  }

  @Delete(':id')
  @RequirePermission('CONFIG_METIERS_POSTES')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}

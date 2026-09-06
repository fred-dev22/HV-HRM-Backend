import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { HolidayService } from './holiday.service';
import { CreateHolidayDto } from './dto/create-holiday.dto';
import { UpdateHolidayDto } from './dto/update-holiday.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { BulkImportDto } from '../../common/dto/bulk-import.dto';

@Controller('holidays')
export class HolidayController {
  constructor(private readonly service: HolidayService) {}

  @Post()
  @RequirePermission('CONFIG_JOURS_FERIES')
  create(
    @Body() dto: CreateHolidayDto,
    @CurrentUser('employeeId') employeeId: string,
  ) {
    return this.service.create(dto, employeeId);
  }

  // Doit rester avant ':id' — sinon Nest matcherait POST /holidays/bulk.
  @Post('bulk')
  @RequirePermission('CONFIG_JOURS_FERIES')
  bulkCreate(
    @Body() dto: BulkImportDto,
    @CurrentUser('employeeId') employeeId: string,
  ) {
    return this.service.bulkCreate(dto.items, employeeId);
  }

  @Get()
  findAll() {
    return this.service.findAll();
  }

  @Get('year/:year')
  findForYear(
    @Param('year', ParseIntPipe) year: number,
    @Query('organizationUnitId') organizationUnitId?: string,
    @Query('gender') gender?: string,
    @Query('isExpatriate') isExpatriate?: string,
  ) {
    return this.service.findForYear(
      year,
      organizationUnitId,
      gender,
      isExpatriate === undefined ? undefined : isExpatriate === 'true',
    );
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Patch(':id')
  @RequirePermission('CONFIG_JOURS_FERIES')
  update(@Param('id') id: string, @Body() dto: UpdateHolidayDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @RequirePermission('CONFIG_JOURS_FERIES')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}

import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { JobService } from './job.service';
import { CreateJobDto } from './dto/create-job.dto';
import { UpdateJobDto } from './dto/update-job.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { BulkImportDto } from '../../common/dto/bulk-import.dto';

@Controller('jobs')
export class JobController {
  constructor(private readonly service: JobService) {}

  @Post()
  @RequirePermission('CONFIG_METIERS_POSTES')
  create(@Body() dto: CreateJobDto, @CurrentUser('employeeId') employeeId: string) {
    return this.service.create(dto, employeeId);
  }

  // Doit rester avant ':id' — sinon Nest matcherait POST /jobs/bulk.
  @Post('bulk')
  @RequirePermission('CONFIG_METIERS_POSTES')
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
  @RequirePermission('CONFIG_METIERS_POSTES')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateJobDto,
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

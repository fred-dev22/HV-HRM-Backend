import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { TalentPoolService } from './talent-pool.service';
import {
  CreateTalentPoolDto,
  UpdateTalentPoolDto,
  AddTalentPoolEvaluationDto,
} from './dto/talent-pool.dto';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { RequirePermission } from '../../../common/decorators/require-permission.decorator';

@Controller('recruitment/talent-pool')
@RequirePermission('RECRUTEMENT_ACCES')
export class TalentPoolController {
  constructor(private readonly service: TalentPoolService) {}

  @Get()
  findAll(@Query('q') q?: string) {
    return this.service.findAll(q);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateTalentPoolDto, @CurrentUser('employeeId') employeeId: string) {
    return this.service.create(dto, employeeId);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateTalentPoolDto,
    @CurrentUser('employeeId') employeeId: string,
  ) {
    return this.service.update(id, dto, employeeId);
  }

  @Post(':id/evaluations')
  addEvaluation(
    @Param('id') id: string,
    @Body() dto: AddTalentPoolEvaluationDto,
    @CurrentUser('employeeId') employeeId: string,
  ) {
    return this.service.addEvaluation(id, dto, employeeId);
  }

  @Post(':id/close')
  close(@Param('id') id: string, @CurrentUser('employeeId') employeeId: string) {
    return this.service.setStatus(id, 'Closed', employeeId);
  }

  @Post(':id/reopen')
  reopen(@Param('id') id: string, @CurrentUser('employeeId') employeeId: string) {
    return this.service.setStatus(id, 'Open', employeeId);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser('employeeId') employeeId: string) {
    return this.service.remove(id, employeeId);
  }
}

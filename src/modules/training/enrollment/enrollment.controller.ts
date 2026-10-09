import { RequireModule } from '../../../common/modules/require-module.decorator';
import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { EnrollmentService } from './enrollment.service';
import { CreateEnrollmentDto, SubmitEvaluationDto } from '../dto/training.dto';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { RequirePermission } from '../../../common/decorators/require-permission.decorator';

@RequireModule('training')
@Controller('training/enrollments')
@RequirePermission('FORMATION_ACCES')
export class EnrollmentController {
  constructor(private readonly service: EnrollmentService) {}

  @Get()
  findAll() {
    return this.service.findAll();
  }

  @Post()
  create(@Body() dto: CreateEnrollmentDto, @CurrentUser('employeeId') employeeId: string) {
    return this.service.create(dto, employeeId);
  }

  @Post(':id/approve')
  approve(@Param('id', ParseUUIDPipe) id: string, @CurrentUser('employeeId') employeeId: string) {
    return this.service.approve(id, employeeId);
  }

  @Post(':id/reject')
  reject(@Param('id', ParseUUIDPipe) id: string, @CurrentUser('employeeId') employeeId: string) {
    return this.service.reject(id, employeeId);
  }

  @Post(':id/cancel')
  cancel(@Param('id', ParseUUIDPipe) id: string, @CurrentUser('employeeId') employeeId: string) {
    return this.service.cancel(id, employeeId);
  }

  @Post(':id/attend')
  attend(@Param('id', ParseUUIDPipe) id: string, @CurrentUser('employeeId') employeeId: string) {
    return this.service.attend(id, employeeId);
  }

  @Post(':id/hot-evaluation')
  hotEvaluation(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SubmitEvaluationDto,
    @CurrentUser('employeeId') employeeId: string,
  ) {
    return this.service.submitHotEvaluation(id, dto, employeeId);
  }

  @Post(':id/cold-evaluation')
  coldEvaluation(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SubmitEvaluationDto,
    @CurrentUser('employeeId') employeeId: string,
  ) {
    return this.service.submitColdEvaluation(id, dto, employeeId);
  }
}

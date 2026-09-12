import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { InterviewService } from './interview.service';
import { ScheduleInterviewDto, UpdateInterviewDto, EvaluateInterviewDto } from './dto/interview.dto';
import { ManualRsvpDto } from './dto/interview-rsvp.dto';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { RequirePermission } from '../../../common/decorators/require-permission.decorator';

@Controller('recruitment/interviews')
@RequirePermission('RECRUTEMENT_ACCES')
export class InterviewController {
  constructor(private readonly service: InterviewService) {}

  @Post()
  schedule(@Body() dto: ScheduleInterviewDto, @CurrentUser('employeeId') employeeId: string) {
    return this.service.schedule(dto, employeeId);
  }

  @Get()
  findAll(@Query('applicationId') applicationId?: string) {
    return this.service.findAll(applicationId);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateInterviewDto,
    @CurrentUser('employeeId') employeeId: string,
  ) {
    return this.service.update(id, dto, employeeId);
  }

  @Post(':id/cancel')
  cancel(@Param('id') id: string, @CurrentUser('employeeId') employeeId: string) {
    return this.service.cancel(id, employeeId);
  }

  @Post(':id/done')
  markDone(@Param('id') id: string, @CurrentUser('employeeId') employeeId: string) {
    return this.service.markDone(id, employeeId);
  }

  @Post(':id/evaluate')
  evaluate(
    @Param('id') id: string,
    @Body() dto: EvaluateInterviewDto,
    @CurrentUser('employeeId') employeeId: string,
  ) {
    return this.service.evaluate(id, dto, employeeId);
  }

  // Correction manuelle d'une reponse a l'invitation (candidat ou participant).
  @Post(':id/rsvp')
  setRsvp(
    @Param('id') id: string,
    @Body() dto: ManualRsvpDto,
    @CurrentUser('employeeId') employeeId: string,
  ) {
    return this.service.setRsvp(id, dto, employeeId);
  }
}

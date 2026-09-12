import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { TrialService } from './trial.service';
import { EvaluateTrialDto, ExtendTrialDto } from './dto/trial.dto';
import { ConfirmTrialDto } from '../contract/dto/convert-to-employee.dto';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { RequirePermission } from '../../../common/decorators/require-permission.decorator';
import { CurrentPermissions } from '../../../common/decorators/current-permissions.decorator';

@Controller('recruitment/trial-employees')
@RequirePermission('RECRUTEMENT_ACCES')
export class TrialController {
  constructor(private readonly service: TrialService) {}

  @Get()
  list() {
    return this.service.list();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post(':id/evaluate')
  evaluate(
    @Param('id') id: string,
    @Body() dto: EvaluateTrialDto,
    @CurrentUser('employeeId') employeeId: string,
  ) {
    return this.service.evaluate(id, dto, employeeId);
  }

  @Post(':id/extend')
  extend(
    @Param('id') id: string,
    @Body() dto: ExtendTrialDto,
    @CurrentUser('employeeId') employeeId: string,
  ) {
    return this.service.extend(id, dto, employeeId);
  }

  @Post(':id/convert')
  convert(
    @Param('id') id: string,
    @Body() dto: ConfirmTrialDto,
    @CurrentUser('employeeId') employeeId: string,
    @CurrentPermissions() permissions: Set<string>,
  ) {
    return this.service.convert(id, employeeId, dto, permissions);
  }

  @Post(':id/cancel')
  cancel(@Param('id') id: string, @CurrentUser('employeeId') employeeId: string) {
    return this.service.cancel(id, employeeId);
  }
}

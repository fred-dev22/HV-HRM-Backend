import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ProviderService } from './provider.service';
import { CreateProviderDto, EvaluateProviderDto, UpdateProviderDto } from '../dto/training.dto';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { RequirePermission } from '../../../common/decorators/require-permission.decorator';

@Controller('training/providers')
@RequirePermission('FORMATION_ACCES')
export class ProviderController {
  constructor(private readonly service: ProviderService) {}

  @Get()
  findAll() {
    return this.service.findAll();
  }

  @Post()
  create(@Body() dto: CreateProviderDto, @CurrentUser('employeeId') employeeId: string) {
    return this.service.create(dto, employeeId);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProviderDto,
    @CurrentUser('employeeId') employeeId: string,
  ) {
    return this.service.update(id, dto, employeeId);
  }

  @Post(':id/evaluate')
  evaluate(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: EvaluateProviderDto,
    @CurrentUser('employeeId') employeeId: string,
  ) {
    return this.service.evaluate(id, dto.score, employeeId);
  }
}

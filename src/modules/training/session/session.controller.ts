import { RequireModule } from '../../../common/modules/require-module.decorator';
import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { SessionService } from './session.service';
import { CreateSessionDto } from '../dto/training.dto';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { RequirePermission } from '../../../common/decorators/require-permission.decorator';

@RequireModule('training')
@Controller('training/sessions')
@RequirePermission('FORMATION_ACCES')
export class SessionController {
  constructor(private readonly service: SessionService) {}

  @Get()
  findAll() {
    return this.service.findAll();
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateSessionDto, @CurrentUser('employeeId') employeeId: string) {
    return this.service.create(dto, employeeId);
  }

  @Post(':id/done')
  markDone(@Param('id', ParseUUIDPipe) id: string, @CurrentUser('employeeId') employeeId: string) {
    return this.service.markDone(id, employeeId);
  }

  @Post(':id/cancel')
  cancel(@Param('id', ParseUUIDPipe) id: string, @CurrentUser('employeeId') employeeId: string) {
    return this.service.cancel(id, employeeId);
  }
}

import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { BudgetService } from './budget.service';
import { CreateBudgetLineDto } from '../dto/training.dto';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { RequirePermission } from '../../../common/decorators/require-permission.decorator';

@Controller('training/budget')
@RequirePermission('FORMATION_ACCES')
export class BudgetController {
  constructor(private readonly service: BudgetService) {}

  @Get()
  findAll() {
    return this.service.findAll();
  }

  @Post()
  create(@Body() dto: CreateBudgetLineDto, @CurrentUser('employeeId') employeeId: string) {
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
}

import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ExpenseConfigService } from './expense-config.service';
import { CreateExpenseConfigDto } from './dto/create-expense-config.dto';
import { UpdateExpenseConfigDto } from './dto/update-expense-config.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';

@Controller('expense-configs')
export class ExpenseConfigController {
  constructor(private readonly service: ExpenseConfigService) {}

  @Post()
  @RequirePermission('CONFIG_FRAIS_MISSION')
  create(@Body() dto: CreateExpenseConfigDto, @CurrentUser('employeeId') employeeId: string) {
    return this.service.create(dto, employeeId);
  }

  @Get()
  findAll() {
    return this.service.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Patch(':id')
  @RequirePermission('CONFIG_FRAIS_MISSION')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateExpenseConfigDto,
    @CurrentUser('employeeId') employeeId: string,
  ) {
    return this.service.update(id, dto, employeeId);
  }

  @Delete(':id')
  @RequirePermission('CONFIG_FRAIS_MISSION')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}

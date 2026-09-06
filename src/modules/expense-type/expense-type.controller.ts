import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ExpenseTypeService } from './expense-type.service';
import { CreateExpenseTypeDto } from './dto/create-expense-type.dto';
import { UpdateExpenseTypeDto } from './dto/update-expense-type.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';

@Controller('expense-types')
export class ExpenseTypeController {
  constructor(private readonly service: ExpenseTypeService) {}

  @Post()
  @RequirePermission('CONFIG_FRAIS_MISSION')
  create(@Body() dto: CreateExpenseTypeDto, @CurrentUser('employeeId') employeeId: string) {
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
    @Body() dto: UpdateExpenseTypeDto,
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

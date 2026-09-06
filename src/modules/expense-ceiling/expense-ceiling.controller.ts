import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ExpenseCeilingService } from './expense-ceiling.service';
import { CreateExpenseCeilingDto } from './dto/create-expense-ceiling.dto';
import { UpdateExpenseCeilingDto } from './dto/update-expense-ceiling.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';

@Controller('expense-ceilings')
export class ExpenseCeilingController {
  constructor(private readonly service: ExpenseCeilingService) {}

  @Post()
  @RequirePermission('CONFIG_FRAIS_MISSION')
  create(@Body() dto: CreateExpenseCeilingDto, @CurrentUser('employeeId') employeeId: string) {
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
    @Body() dto: UpdateExpenseCeilingDto,
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

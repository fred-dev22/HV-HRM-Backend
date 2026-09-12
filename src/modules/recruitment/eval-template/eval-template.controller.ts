import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { EvalTemplateService } from './eval-template.service';
import { CreateEvalTemplateDto, UpdateEvalTemplateDto } from './dto/eval-template.dto';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { RequirePermission } from '../../../common/decorators/require-permission.decorator';

@Controller('recruitment/evaluation-templates')
@RequirePermission('RECRUTEMENT_ACCES')
export class EvalTemplateController {
  constructor(private readonly service: EvalTemplateService) {}

  @Post()
  create(@Body() dto: CreateEvalTemplateDto, @CurrentUser('employeeId') employeeId: string) {
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
  update(
    @Param('id') id: string,
    @Body() dto: UpdateEvalTemplateDto,
    @CurrentUser('employeeId') employeeId: string,
  ) {
    return this.service.update(id, dto, employeeId);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser('employeeId') employeeId: string) {
    return this.service.remove(id, employeeId);
  }
}

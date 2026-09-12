import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { HiringRequestService } from './hiring-request.service';
import { CreateHiringRequestDto } from './dto/create-hiring-request.dto';
import { UpdateHiringRequestDto } from './dto/update-hiring-request.dto';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { CurrentPermissions } from '../../../common/decorators/current-permissions.decorator';

// Pas de @RequirePermission de classe ici : l'expression de besoin est
// ouverte a l'espace Administration (RECRUTEMENT_BESOIN_VOIR /
// RECRUTEMENT_BESOIN_EXPRIMER) autant qu'au module (RECRUTEMENT_ACCES). Le
// controle fin est fait dans le service via les helpers assertBesoin*.
@Controller('recruitment/hiring-requests')
export class HiringRequestController {
  constructor(private readonly service: HiringRequestService) {}

  @Post()
  create(
    @Body() dto: CreateHiringRequestDto,
    @CurrentUser('employeeId') employeeId: string,
    @CurrentPermissions() permissions: Set<string>,
  ) {
    return this.service.create(dto, employeeId, permissions);
  }

  @Get()
  findAll(@CurrentPermissions() permissions: Set<string>) {
    return this.service.findAll(permissions);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentPermissions() permissions: Set<string>) {
    return this.service.findOne(id, permissions);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateHiringRequestDto,
    @CurrentUser('employeeId') employeeId: string,
    @CurrentPermissions() permissions: Set<string>,
  ) {
    return this.service.update(id, dto, employeeId, permissions);
  }

  @Post(':id/submit')
  submit(
    @Param('id') id: string,
    @CurrentUser('employeeId') employeeId: string,
    @CurrentPermissions() permissions: Set<string>,
  ) {
    return this.service.submit(id, employeeId, permissions);
  }

  @Post(':id/close')
  close(
    @Param('id') id: string,
    @CurrentUser('employeeId') employeeId: string,
    @CurrentPermissions() permissions: Set<string>,
  ) {
    return this.service.close(id, employeeId, permissions);
  }

  @Post(':id/cancel')
  cancel(
    @Param('id') id: string,
    @CurrentUser('employeeId') employeeId: string,
    @CurrentPermissions() permissions: Set<string>,
  ) {
    return this.service.cancel(id, employeeId, permissions);
  }

  @Delete(':id')
  remove(
    @Param('id') id: string,
    @CurrentUser('employeeId') employeeId: string,
    @CurrentPermissions() permissions: Set<string>,
  ) {
    return this.service.remove(id, employeeId, permissions);
  }
}

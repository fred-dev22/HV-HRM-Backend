import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ContractService } from './contract.service';
import {
  GenerateContractDto,
  UpdateContractDto,
  NegotiateContractDto,
  RefuseContractDto,
  ContractTemplateDto,
  UpdateContractTemplateDto,
} from './dto/contract.dto';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { RequirePermission } from '../../../common/decorators/require-permission.decorator';
import { CurrentPermissions } from '../../../common/decorators/current-permissions.decorator';
import { EmployeeConversionService } from './employee-conversion.service';
import { ConvertContractToEmployeeDto } from './dto/convert-to-employee.dto';

@Controller('recruitment/contract-templates')
@RequirePermission('RECRUTEMENT_ACCES')
export class ContractTemplateController {
  constructor(private readonly service: ContractService) {}

  @Get()
  list() {
    return this.service.listTemplates();
  }

  @Post()
  create(@Body() dto: ContractTemplateDto, @CurrentUser('employeeId') employeeId: string) {
    return this.service.createTemplate(dto, employeeId);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateContractTemplateDto,
    @CurrentUser('employeeId') employeeId: string,
  ) {
    return this.service.updateTemplate(id, dto, employeeId);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser('employeeId') employeeId: string) {
    return this.service.removeTemplate(id, employeeId);
  }
}

@Controller('recruitment/contracts')
@RequirePermission('RECRUTEMENT_ACCES')
export class ContractController {
  constructor(
    private readonly service: ContractService,
    private readonly conversionService: EmployeeConversionService,
  ) {}

  // Doit rester avant ':id'.
  @Get('eligible-applications')
  eligibleApplications() {
    return this.service.eligibleApplications();
  }

  @Get()
  list() {
    return this.service.list();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  generate(@Body() dto: GenerateContractDto, @CurrentUser('employeeId') employeeId: string) {
    return this.service.generate(dto, employeeId);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateContractDto,
    @CurrentUser('employeeId') employeeId: string,
  ) {
    return this.service.update(id, dto, employeeId);
  }

  @Post(':id/send')
  send(@Param('id') id: string, @CurrentUser('employeeId') employeeId: string) {
    return this.service.send(id, employeeId);
  }

  @Post(':id/negotiate')
  negotiate(
    @Param('id') id: string,
    @Body() dto: NegotiateContractDto,
    @CurrentUser('employeeId') employeeId: string,
  ) {
    return this.service.negotiate(id, dto, employeeId);
  }

  @Post(':id/accept')
  accept(@Param('id') id: string, @CurrentUser('employeeId') employeeId: string) {
    return this.service.accept(id, employeeId);
  }

  @Post(':id/refuse')
  refuse(
    @Param('id') id: string,
    @Body() dto: RefuseContractDto,
    @CurrentUser('employeeId') employeeId: string,
  ) {
    return this.service.refuse(id, dto, employeeId);
  }

  @Post(':id/cancel')
  cancel(@Param('id') id: string, @CurrentUser('employeeId') employeeId: string) {
    return this.service.cancel(id, employeeId);
  }

  // Conversion du contrat accepte en employe reel ("Inclusion d'un Potentiel").
  // RECRUTEMENT_ACCES (classe) donne l'acces a la route ; EMPLOYE_CREER est
  // verifie dans EmployeeConversionService a partir de @CurrentPermissions()
  // (un @RequirePermission de methode REMPLACERAIT la permission de classe,
  // voir PermissionGuard.reflector.getAllAndOverride).
  @Post(':id/convert-to-employee')
  convertToEmployee(
    @Param('id') id: string,
    @Body() dto: ConvertContractToEmployeeDto,
    @CurrentUser('employeeId') employeeId: string,
    @CurrentPermissions() permissions: Set<string>,
  ) {
    return this.conversionService.convertContract(id, dto, employeeId, permissions);
  }
}

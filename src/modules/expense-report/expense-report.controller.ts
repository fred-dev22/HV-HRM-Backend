import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ExpenseReportService } from './expense-report.service';
import { CreateExpenseReportDto } from './dto/create-expense-report.dto';
import { UpdateExpenseReportDto } from './dto/update-expense-report.dto';
import { DecideExpenseReportDto } from './dto/decide-expense-report.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CurrentPermissions } from '../../common/decorators/current-permissions.decorator';

@Controller('expense-reports')
export class ExpenseReportController {
  constructor(private readonly service: ExpenseReportService) {}

  @Post()
  create(
    @Body() dto: CreateExpenseReportDto,
    @CurrentUser('employeeId') employeeId: string,
  ) {
    return this.service.create(dto, employeeId);
  }

  // Doit rester avant ':id' — sinon Nest matcherait ces segments comme des id.
  @Get('mine')
  findMine(@CurrentUser('employeeId') employeeId: string) {
    return this.service.findMine(employeeId);
  }

  @Get('team')
  @RequirePermission('FRAIS_VOIR_EQUIPE')
  findTeam(@CurrentUser('employeeId') employeeId: string) {
    return this.service.findTeam(employeeId);
  }

  @Get('pending-for-me')
  @RequirePermission('FRAIS_VALIDER')
  findPendingForMe(@CurrentUser('employeeId') employeeId: string) {
    return this.service.findPendingForMe(employeeId);
  }

  @Get()
  @RequirePermission('FRAIS_VOIR_TOUT')
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
    @Body() dto: UpdateExpenseReportDto,
    @CurrentUser('employeeId') employeeId: string,
    @CurrentPermissions() permissions: Set<string>,
  ) {
    return this.service.update(id, dto, employeeId, permissions.has('FRAIS_VOIR_TOUT'));
  }

  @Delete(':id')
  remove(
    @Param('id') id: string,
    @CurrentUser('employeeId') employeeId: string,
    @CurrentPermissions() permissions: Set<string>,
  ) {
    return this.service.remove(id, employeeId, permissions.has('FRAIS_VOIR_TOUT'));
  }

  @Post(':id/submit')
  submit(
    @Param('id') id: string,
    @CurrentUser('employeeId') employeeId: string,
    @CurrentPermissions() permissions: Set<string>,
  ) {
    return this.service.submit(id, employeeId, permissions.has('FRAIS_VOIR_TOUT'));
  }

  @Patch(':id/approve')
  @RequirePermission('FRAIS_VALIDER')
  approve(
    @Param('id') id: string,
    @Body() dto: DecideExpenseReportDto,
    @CurrentUser('employeeId') employeeId: string,
    @CurrentPermissions() permissions: Set<string>,
  ) {
    return this.service.approve(id, dto, employeeId, permissions.has('FRAIS_VOIR_TOUT'));
  }

  @Patch(':id/reject')
  @RequirePermission('FRAIS_VALIDER')
  reject(
    @Param('id') id: string,
    @Body() dto: DecideExpenseReportDto,
    @CurrentUser('employeeId') employeeId: string,
    @CurrentPermissions() permissions: Set<string>,
  ) {
    return this.service.reject(id, dto, employeeId, permissions.has('FRAIS_VOIR_TOUT'));
  }

  @Patch(':id/return')
  @RequirePermission('FRAIS_VALIDER')
  return_(
    @Param('id') id: string,
    @Body() dto: DecideExpenseReportDto,
    @CurrentUser('employeeId') employeeId: string,
    @CurrentPermissions() permissions: Set<string>,
  ) {
    return this.service.return_(id, dto, employeeId, permissions.has('FRAIS_VOIR_TOUT'));
  }

  @Patch(':id/cancel')
  cancel(
    @Param('id') id: string,
    @CurrentUser('employeeId') employeeId: string,
    @CurrentPermissions() permissions: Set<string>,
  ) {
    return this.service.cancel(id, employeeId, permissions.has('FRAIS_VOIR_TOUT'));
  }

  // Suppression definitive (Lot I) — distincte de DELETE /:id ci-dessus
  // (reservee aux brouillons). Route separee pour ne pas changer le sens de
  // l'existant.
  @Delete(':id/permanent')
  @RequirePermission('FRAIS_SUPPRIMER')
  softDelete(@Param('id') id: string, @CurrentUser('employeeId') employeeId: string) {
    return this.service.softDelete(id, employeeId);
  }
}

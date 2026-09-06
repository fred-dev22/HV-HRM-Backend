import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { LeaveRequestService } from './leave-request.service';
import { CreateLeaveRequestDto } from './dto/create-leave-request.dto';
import { UpdateLeaveRequestDto } from './dto/update-leave-request.dto';
import { DecideLeaveRequestDto } from './dto/decide-leave-request.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CurrentPermissions } from '../../common/decorators/current-permissions.decorator';

@Controller('leave-requests')
export class LeaveRequestController {
  constructor(private readonly service: LeaveRequestService) {}

  @Post()
  create(
    @Body() dto: CreateLeaveRequestDto,
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
  @RequirePermission('CONGE_VOIR_EQUIPE')
  findTeam(@CurrentUser('employeeId') employeeId: string) {
    return this.service.findTeam(employeeId);
  }

  @Get('pending-for-me')
  @RequirePermission('CONGE_VALIDER')
  findPendingForMe(@CurrentUser('employeeId') employeeId: string) {
    return this.service.findPendingForMe(employeeId);
  }

  @Get('validated-by-me')
  @RequirePermission('CONGE_VALIDER')
  findValidatedByMe(@CurrentUser('employeeId') employeeId: string) {
    return this.service.findValidatedByMe(employeeId);
  }

  @Get()
  @RequirePermission('CONGE_VOIR_TOUT')
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
    @Body() dto: UpdateLeaveRequestDto,
    @CurrentUser('employeeId') employeeId: string,
    @CurrentPermissions() permissions: Set<string>,
  ) {
    return this.service.update(id, dto, employeeId, permissions.has('CONGE_VOIR_TOUT'));
  }

  @Delete(':id')
  remove(
    @Param('id') id: string,
    @CurrentUser('employeeId') employeeId: string,
    @CurrentPermissions() permissions: Set<string>,
  ) {
    return this.service.remove(id, employeeId, permissions.has('CONGE_VOIR_TOUT'));
  }

  @Post(':id/submit')
  submit(
    @Param('id') id: string,
    @CurrentUser('employeeId') employeeId: string,
    @CurrentPermissions() permissions: Set<string>,
  ) {
    return this.service.submit(id, employeeId, permissions.has('CONGE_VOIR_TOUT'));
  }

  @Patch(':id/approve')
  @RequirePermission('CONGE_VALIDER')
  approve(
    @Param('id') id: string,
    @Body() dto: DecideLeaveRequestDto,
    @CurrentUser('employeeId') employeeId: string,
    @CurrentPermissions() permissions: Set<string>,
  ) {
    return this.service.approve(id, dto, employeeId, permissions.has('CONGE_VOIR_TOUT'));
  }

  @Patch(':id/reject')
  @RequirePermission('CONGE_VALIDER')
  reject(
    @Param('id') id: string,
    @Body() dto: DecideLeaveRequestDto,
    @CurrentUser('employeeId') employeeId: string,
    @CurrentPermissions() permissions: Set<string>,
  ) {
    return this.service.reject(id, dto, employeeId, permissions.has('CONGE_VOIR_TOUT'));
  }

  @Patch(':id/return')
  @RequirePermission('CONGE_VALIDER')
  return_(
    @Param('id') id: string,
    @Body() dto: DecideLeaveRequestDto,
    @CurrentUser('employeeId') employeeId: string,
    @CurrentPermissions() permissions: Set<string>,
  ) {
    return this.service.return_(id, dto, employeeId, permissions.has('CONGE_VOIR_TOUT'));
  }

  @Patch(':id/cancel')
  cancel(
    @Param('id') id: string,
    @CurrentUser('employeeId') employeeId: string,
    @CurrentPermissions() permissions: Set<string>,
  ) {
    return this.service.cancel(id, employeeId, permissions.has('CONGE_VOIR_TOUT'));
  }

  @Patch(':id/mark-done')
  markDone(@Param('id') id: string, @CurrentUser('employeeId') employeeId: string) {
    return this.service.markDone(id, employeeId);
  }

  @Patch(':id/regularize')
  regularize(@Param('id') id: string, @CurrentUser('employeeId') employeeId: string) {
    return this.service.regularize(id, employeeId);
  }

  // Suppression definitive (Lot I) — distincte de DELETE /:id ci-dessus
  // (reservee aux brouillons). Route separee pour ne pas changer le sens de
  // l'existant.
  @Delete(':id/permanent')
  @RequirePermission('CONGE_SUPPRIMER')
  softDelete(@Param('id') id: string, @CurrentUser('employeeId') employeeId: string) {
    return this.service.softDelete(id, employeeId);
  }
}

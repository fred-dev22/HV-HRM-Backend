import { Body, Controller, Delete, ForbiddenException, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { LeaveRequestService } from './leave-request.service';
import { CreateLeaveRequestDto } from './dto/create-leave-request.dto';
import { UpdateLeaveRequestDto } from './dto/update-leave-request.dto';
import { DecideLeaveRequestDto } from './dto/decide-leave-request.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CurrentPermissions } from '../../common/decorators/current-permissions.decorator';
import { parseListQuery } from '../../common/utils/list-query.util';

@Controller('leave-requests')
export class LeaveRequestController {
  constructor(private readonly service: LeaveRequestService) {}

  @Post()
  create(
    @Body() dto: CreateLeaveRequestDto,
    @CurrentUser('employeeId') employeeId: string,
    @CurrentPermissions() permissions: Set<string>,
  ) {
    // Sans la permission, seule la creation pour soi ou pour un employe de sa
    // propre entite est permise : verifie dans le service (voir assertMayCreateFor).
    return this.service.create(dto, employeeId, permissions.has('CONGE_CREER_POUR_AUTRE'));
  }

  // Doit rester avant ':id' — sinon Nest matcherait ces segments comme des id.
  @Get('mine')
  findMine(
    @CurrentUser('employeeId') employeeId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.service.findMine(employeeId, from && to ? { from, to } : undefined);
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

  // Liste paginee, filtree et triee cote serveur. La portee est choisie par
  // l'appelant mais verifiee ici : all/team exigent la permission.
  @Get('page')
  findPage(
    @CurrentUser('employeeId') employeeId: string,
    @CurrentPermissions() permissions: Set<string>,
    @Query('scope') scope = 'mine',
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('search') search?: string,
    @Query('sort') sort?: string,
    @Query('dir') dir?: string,
    @Query('status') status?: string,
    @Query('type') type?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    if (scope === 'all' && !permissions.has('CONGE_VOIR_TOUT')) {
      throw new ForbiddenException("Vous n'avez pas la permission requise (CONGE_VOIR_TOUT) pour effectuer cette action");
    }
    if (scope === 'team' && !permissions.has('CONGE_VOIR_EQUIPE')) {
      throw new ForbiddenException("Vous n'avez pas la permission requise (CONGE_VOIR_EQUIPE) pour effectuer cette action");
    }
    const safeScope = scope === 'all' || scope === 'team' ? scope : 'mine';
    return this.service.findPage(
      safeScope,
      employeeId,
      parseListQuery({ page, pageSize, search, sort, dir }),
      { status, type, from, to },
    );
  }

  @Get('recently-approved')
  @RequirePermission('CONGE_VOIR_TOUT')
  findRecentlyApproved(@Query('limit') limit?: string) {
    return this.service.findRecentlyApproved(limit ? Number(limit) || 10 : 10);
  }

  @Get()
  @RequirePermission('CONGE_VOIR_TOUT')
  findAll(@Query('from') from?: string, @Query('to') to?: string) {
    return this.service.findAll(from && to ? { from, to } : undefined);
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

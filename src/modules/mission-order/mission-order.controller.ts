import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { MissionOrderService } from './mission-order.service';
import { CreateMissionOrderDto } from './dto/create-mission-order.dto';
import { UpdateMissionOrderDto } from './dto/update-mission-order.dto';
import { DecideMissionOrderDto } from './dto/decide-mission-order.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CurrentPermissions } from '../../common/decorators/current-permissions.decorator';

@Controller('mission-orders')
export class MissionOrderController {
  constructor(private readonly service: MissionOrderService) {}

  @Post()
  create(
    @Body() dto: CreateMissionOrderDto,
    @CurrentUser('employeeId') employeeId: string,
  ) {
    return this.service.create(dto, employeeId);
  }

  // Doit rester avant ':id' — sinon Nest matcherait ces segments comme des id.
  @Get('estimate')
  estimate(
    @Query('employeeId') employeeId: string,
    @Query('missionCategory') missionCategory: string,
    @Query('departureDate') departureDate: string,
    @Query('returnDate') returnDate: string,
    @CurrentUser('employeeId') requesterEmployeeId: string,
  ) {
    return this.service.estimate(employeeId || requesterEmployeeId, missionCategory, departureDate, returnDate);
  }

  @Get('mine')
  findMine(
    @CurrentUser('employeeId') employeeId: string,
    @Query('forEmployeeId') forEmployeeId?: string,
  ) {
    return this.service.findMine(employeeId, forEmployeeId);
  }

  @Get('team')
  @RequirePermission('MISSION_VOIR_EQUIPE')
  findTeam(@CurrentUser('employeeId') employeeId: string) {
    return this.service.findTeam(employeeId);
  }

  @Get('pending-for-me')
  @RequirePermission('MISSION_VALIDER')
  findPendingForMe(@CurrentUser('employeeId') employeeId: string) {
    return this.service.findPendingForMe(employeeId);
  }

  @Get()
  @RequirePermission('MISSION_VOIR_TOUT')
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
    @Body() dto: UpdateMissionOrderDto,
    @CurrentUser('employeeId') employeeId: string,
    @CurrentPermissions() permissions: Set<string>,
  ) {
    return this.service.update(id, dto, employeeId, permissions.has('MISSION_VOIR_TOUT'));
  }

  @Delete(':id')
  remove(
    @Param('id') id: string,
    @CurrentUser('employeeId') employeeId: string,
    @CurrentPermissions() permissions: Set<string>,
  ) {
    return this.service.remove(id, employeeId, permissions.has('MISSION_VOIR_TOUT'));
  }

  @Post(':id/submit')
  submit(
    @Param('id') id: string,
    @CurrentUser('employeeId') employeeId: string,
    @CurrentPermissions() permissions: Set<string>,
  ) {
    return this.service.submit(id, employeeId, permissions.has('MISSION_VOIR_TOUT'));
  }

  @Patch(':id/approve')
  @RequirePermission('MISSION_VALIDER')
  approve(
    @Param('id') id: string,
    @Body() dto: DecideMissionOrderDto,
    @CurrentUser('employeeId') employeeId: string,
    @CurrentPermissions() permissions: Set<string>,
  ) {
    return this.service.approve(id, dto, employeeId, permissions.has('MISSION_VOIR_TOUT'));
  }

  @Patch(':id/reject')
  @RequirePermission('MISSION_VALIDER')
  reject(
    @Param('id') id: string,
    @Body() dto: DecideMissionOrderDto,
    @CurrentUser('employeeId') employeeId: string,
    @CurrentPermissions() permissions: Set<string>,
  ) {
    return this.service.reject(id, dto, employeeId, permissions.has('MISSION_VOIR_TOUT'));
  }

  @Patch(':id/return')
  @RequirePermission('MISSION_VALIDER')
  return_(
    @Param('id') id: string,
    @Body() dto: DecideMissionOrderDto,
    @CurrentUser('employeeId') employeeId: string,
    @CurrentPermissions() permissions: Set<string>,
  ) {
    return this.service.return_(id, dto, employeeId, permissions.has('MISSION_VOIR_TOUT'));
  }

  @Patch(':id/cancel')
  cancel(
    @Param('id') id: string,
    @CurrentUser('employeeId') employeeId: string,
    @CurrentPermissions() permissions: Set<string>,
  ) {
    return this.service.cancel(id, employeeId, permissions.has('MISSION_VOIR_TOUT'));
  }

  // Suppression definitive (Lot I) — distincte de DELETE /:id ci-dessus
  // (reservee aux brouillons). Route separee pour ne pas changer le sens de
  // l'existant.
  @Delete(':id/permanent')
  @RequirePermission('MISSION_SUPPRIMER')
  softDelete(@Param('id') id: string, @CurrentUser('employeeId') employeeId: string) {
    return this.service.softDelete(id, employeeId);
  }
}

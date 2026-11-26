import { Body, Controller, ForbiddenException, Get, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { RequireModule } from '../../../common/modules/require-module.decorator';
import { RequirePermission } from '../../../common/decorators/require-permission.decorator';
import { CurrentPermissions } from '../../../common/decorators/current-permissions.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { TimeWeekService } from './time-week.service';
import { ReopenWeekDto, SaveWeekDto, WeekListQueryDto, WeekQueryDto } from './time-week.dto';

// Ecran de validation hebdomadaire : le manager (equipe) corrige et controle, le
// RH valide et rouvre.
function requireReviewer(permissions: Set<string>) {
  if (!permissions.has('TEMPS_ACCES') && !permissions.has('TEMPS_VALIDER')) throw new ForbiddenException();
}

@RequireModule('time')
@Controller('time/weeks')
export class TimeWeekController {
  constructor(private readonly service: TimeWeekService) {}

  @Get()
  list(@Query() q: WeekListQueryDto, @CurrentUser('employeeId') me: string, @CurrentPermissions() permissions: Set<string>) {
    requireReviewer(permissions);
    return this.service.list(q, me, permissions);
  }

  @Get(':employeeId')
  week(
    @Param('employeeId', ParseUUIDPipe) employeeId: string,
    @Query() q: WeekQueryDto,
    @CurrentUser('employeeId') me: string,
    @CurrentPermissions() permissions: Set<string>,
  ) {
    requireReviewer(permissions);
    return this.service.week(employeeId, q.WeekStart, me, permissions);
  }

  @Put(':employeeId/days')
  save(
    @Param('employeeId', ParseUUIDPipe) employeeId: string,
    @Body() dto: SaveWeekDto,
    @CurrentUser('employeeId') me: string,
    @CurrentPermissions() permissions: Set<string>,
  ) {
    requireReviewer(permissions);
    return this.service.saveDays(employeeId, dto, me, permissions);
  }

  @Post(':employeeId/control')
  control(
    @Param('employeeId', ParseUUIDPipe) employeeId: string,
    @Body() dto: WeekQueryDto,
    @CurrentUser('employeeId') me: string,
    @CurrentPermissions() permissions: Set<string>,
  ) {
    requireReviewer(permissions);
    return this.service.control(employeeId, dto.WeekStart, me, permissions);
  }

  @Post(':employeeId/validate')
  @RequirePermission('TEMPS_ACCES')
  validate(
    @Param('employeeId', ParseUUIDPipe) employeeId: string,
    @Body() dto: WeekQueryDto,
    @CurrentUser('employeeId') me: string,
    @CurrentPermissions() permissions: Set<string>,
  ) {
    return this.service.validate(employeeId, dto.WeekStart, me, permissions);
  }

  @Post(':employeeId/reopen')
  @RequirePermission('TEMPS_ACCES')
  reopen(
    @Param('employeeId', ParseUUIDPipe) employeeId: string,
    @Body() dto: ReopenWeekDto,
    @CurrentUser('employeeId') me: string,
    @CurrentPermissions() permissions: Set<string>,
  ) {
    return this.service.reopen(employeeId, dto.WeekStart, dto.Comment, me, permissions);
  }
}

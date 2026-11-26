import { Body, Controller, Delete, ForbiddenException, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { RequireModule } from '../../../common/modules/require-module.decorator';
import { CurrentPermissions } from '../../../common/decorators/current-permissions.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { TimeEntryService } from './time-entry.service';
import { AdjustTimeEntryDto, CreateTimeEntryBatchDto, CreateTimeEntryDto, CreateTimeEntryLinesDto, DecideTimeEntryDto, QueryTimeEntriesDto, UpdateTimeEntryDto } from './time-entry.dto';

// @RequirePermission n'accepte qu'un seul code : les routes ouvertes a
// plusieurs permissions (employe OU validateur OU RH) controlent ici, et le
// service affine (soi-meme, autre employe, validateur courant).
function requireAny(permissions: Set<string>, ...codes: string[]) {
  if (!codes.some((c) => permissions.has(c))) throw new ForbiddenException();
}

@RequireModule('time')
@Controller('time/entries')
export class TimeEntryController {
  constructor(private readonly service: TimeEntryService) {}

  @Post()
  create(@Body() dto: CreateTimeEntryDto, @CurrentUser('employeeId') me: string, @CurrentPermissions() permissions: Set<string>) {
    requireAny(permissions, 'TEMPS_SAISIR', 'TEMPS_VALIDER', 'TEMPS_ACCES');
    return this.service.create(dto, me, permissions);
  }

  // Saisie en lot et import : le RH pour tout le monde, un manager pour son equipe.
  @Post('batch')
  createBatch(@Body() dto: CreateTimeEntryBatchDto, @CurrentUser('employeeId') me: string, @CurrentPermissions() permissions: Set<string>) {
    requireAny(permissions, 'TEMPS_VALIDER', 'TEMPS_ACCES');
    return this.service.createBatch(dto, me, permissions);
  }

  @Post('lines')
  createLines(@Body() dto: CreateTimeEntryLinesDto, @CurrentUser('employeeId') me: string, @CurrentPermissions() permissions: Set<string>) {
    requireAny(permissions, 'TEMPS_VALIDER', 'TEMPS_ACCES');
    return this.service.createLines(dto, me, permissions);
  }

  @Get('employees')
  employees(@CurrentUser('employeeId') me: string, @CurrentPermissions() permissions: Set<string>) {
    requireAny(permissions, 'TEMPS_VALIDER', 'TEMPS_ACCES');
    return this.service.entryEmployees(me, permissions);
  }

  @Get('mine')
  mine(@Query() q: QueryTimeEntriesDto, @CurrentUser('employeeId') me: string, @CurrentPermissions() permissions: Set<string>) {
    requireAny(permissions, 'TEMPS_SAISIR', 'TEMPS_VALIDER', 'TEMPS_ACCES');
    return this.service.findMine(me, q);
  }

  @Get('pending')
  pending(@Query() q: QueryTimeEntriesDto, @CurrentUser('employeeId') me: string, @CurrentPermissions() permissions: Set<string>) {
    requireAny(permissions, 'TEMPS_VALIDER', 'TEMPS_ACCES');
    return this.service.findPendingForMe(me, permissions, q);
  }

  @Get('summary')
  summary(@Query() q: QueryTimeEntriesDto, @CurrentUser('employeeId') me: string, @CurrentPermissions() permissions: Set<string>) {
    requireAny(permissions, 'TEMPS_SAISIR', 'TEMPS_VALIDER', 'TEMPS_ACCES');
    return this.service.summary(me, permissions, q);
  }

  @Get('processed')
  processed(@Query() q: QueryTimeEntriesDto, @CurrentUser('employeeId') me: string, @CurrentPermissions() permissions: Set<string>) {
    requireAny(permissions, 'TEMPS_VALIDER', 'TEMPS_ACCES');
    return this.service.findProcessed(me, permissions, q);
  }

  @Get()
  findAll(@Query() q: QueryTimeEntriesDto, @CurrentUser('employeeId') me: string, @CurrentPermissions() permissions: Set<string>) {
    requireAny(permissions, 'TEMPS_VALIDER', 'TEMPS_ACCES');
    return this.service.findAll(q, me, permissions);
  }

  @Get(':id/history')
  history(@Param('id', ParseUUIDPipe) id: string, @CurrentUser('employeeId') me: string, @CurrentPermissions() permissions: Set<string>) {
    requireAny(permissions, 'TEMPS_SAISIR', 'TEMPS_VALIDER', 'TEMPS_ACCES');
    return this.service.history(id, me, permissions);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTimeEntryDto,
    @CurrentUser('employeeId') me: string,
    @CurrentPermissions() permissions: Set<string>,
  ) {
    requireAny(permissions, 'TEMPS_SAISIR', 'TEMPS_VALIDER', 'TEMPS_ACCES');
    return this.service.update(id, dto, me, permissions);
  }

  @Delete(':id')
  cancel(@Param('id', ParseUUIDPipe) id: string, @CurrentUser('employeeId') me: string, @CurrentPermissions() permissions: Set<string>) {
    requireAny(permissions, 'TEMPS_SAISIR', 'TEMPS_VALIDER', 'TEMPS_ACCES');
    return this.service.cancel(id, me, permissions);
  }

  // Le validateur courant ajuste les heures avant de decider (historique conserve).
  @Patch(':id/adjust')
  adjust(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdjustTimeEntryDto,
    @CurrentUser('employeeId') me: string,
    @CurrentPermissions() permissions: Set<string>,
  ) {
    requireAny(permissions, 'TEMPS_VALIDER', 'TEMPS_ACCES');
    return this.service.adjust(id, dto, me, permissions);
  }

  @Post(':id/approve')
  approve(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DecideTimeEntryDto,
    @CurrentUser('employeeId') me: string,
    @CurrentPermissions() permissions: Set<string>,
  ) {
    requireAny(permissions, 'TEMPS_VALIDER', 'TEMPS_ACCES');
    return this.service.approve(id, dto, me, permissions);
  }

  @Post(':id/reject')
  reject(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DecideTimeEntryDto,
    @CurrentUser('employeeId') me: string,
    @CurrentPermissions() permissions: Set<string>,
  ) {
    requireAny(permissions, 'TEMPS_VALIDER', 'TEMPS_ACCES');
    return this.service.reject(id, dto, me, permissions);
  }
}

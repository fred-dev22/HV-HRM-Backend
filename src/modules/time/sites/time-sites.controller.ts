import { Body, Controller, Delete, ForbiddenException, Get, Param, ParseUUIDPipe, Patch, Post, Put } from '@nestjs/common';
import { RequireModule } from '../../../common/modules/require-module.decorator';
import { RequirePermission } from '../../../common/decorators/require-permission.decorator';
import { CurrentPermissions } from '../../../common/decorators/current-permissions.decorator';
import { TimeSitesService } from './time-sites.service';
import { CreateTimeSiteDto, SetSiteEmployeesDto, UpdateTimeSiteDto } from './time-sites.dto';

// La liste des sites sert aussi aux fiches employe ; les modifier reste reserve
// a l'administration du temps de travail.
const READERS = ['TEMPS_ACCES', 'EMPLOYE_CREER', 'EMPLOYE_MODIFIER', 'EMPLOYE_VOIR_TOUT'];

@RequireModule('time')
@Controller('time/sites')
export class TimeSitesController {
  constructor(private readonly service: TimeSitesService) {}

  @Get()
  findAll(@CurrentPermissions() permissions: Set<string>) {
    if (!READERS.some((code) => permissions.has(code))) throw new ForbiddenException();
    return this.service.findAll();
  }

  @Get('employees')
  @RequirePermission('TEMPS_ACCES')
  employees() {
    return this.service.employees();
  }

  @Post()
  @RequirePermission('TEMPS_ACCES')
  create(@Body() dto: CreateTimeSiteDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  @RequirePermission('TEMPS_ACCES')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateTimeSiteDto) {
    return this.service.update(id, dto);
  }

  @Put(':id/employees')
  @RequirePermission('TEMPS_ACCES')
  setEmployees(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SetSiteEmployeesDto) {
    return this.service.setEmployees(id, dto.EmployeeIds);
  }

  @Delete(':id')
  @RequirePermission('TEMPS_ACCES')
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.remove(id);
  }
}

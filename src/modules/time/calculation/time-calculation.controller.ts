import { Body, Controller, ForbiddenException, Get, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import * as ExcelJS from 'exceljs';
import { RequireModule } from '../../../common/modules/require-module.decorator';
import { RequirePermission } from '../../../common/decorators/require-permission.decorator';
import { CurrentPermissions } from '../../../common/decorators/current-permissions.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { TimeCalculationService } from './time-calculation.service';
import { CalculateDailyHoursDto, CalculateOvertimeDto, PeriodDto, TimesheetQueryDto } from './time-calculation.dto';

@RequireModule('time')
@Controller('time')
export class TimeCalculationController {
  constructor(private readonly service: TimeCalculationService) {}

  @Post('calculation/daily-hours')
  @RequirePermission('TEMPS_ACCES')
  dailyHours(@Body() dto: CalculateDailyHoursDto) {
    return this.service.calculateDailyHours(dto.From, dto.To, {
      deductBreak: dto.DeductBreak,
      includeNonWorkingDays: dto.IncludeNonWorkingDays,
    });
  }

  @Post('calculation/overtime')
  @RequirePermission('TEMPS_ACCES')
  overtime(@Body() dto: CalculateOvertimeDto) {
    return this.service.calculateOvertime(dto.From, dto.To, dto.Method ?? 'daily');
  }

  @Get('calculation/report')
  @RequirePermission('TEMPS_ACCES')
  report(@Query() q: PeriodDto) {
    return this.service.overtimeReport(q.From, q.To);
  }

  @Get('calculation/sage-export')
  @RequirePermission('TEMPS_ACCES')
  sageExport(@Query() q: PeriodDto) {
    return this.service.sageRows(q.From, q.To);
  }

  // Meme export, au format Excel (IM / TYPE / CODE / VALEUR).
  @Get('calculation/sage-export.xlsx')
  @RequirePermission('TEMPS_ACCES')
  async sageExportXlsx(@Query() q: PeriodDto, @Res() res: Response) {
    const rows = await this.service.sageRows(q.From, q.To);
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Sage');
    sheet.addRow(['IM', 'TYPE', 'CODE', 'VALEUR']);
    for (const r of rows) sheet.addRow([r.im, r.type, r.code, r.valeur]);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="export-sage-${q.From}-${q.To}.xlsx"`);
    await workbook.xlsx.write(res);
    res.end();
  }

  // Feuille de temps : la sienne avec TEMPS_SAISIR, celle d'un autre avec TEMPS_ACCES.
  @Get('timesheet')
  timesheet(
    @Query() q: TimesheetQueryDto,
    @CurrentUser('employeeId') me: string,
    @CurrentPermissions() permissions: Set<string>,
  ) {
    const target = q.EmployeeId ?? me;
    const admin = permissions.has('TEMPS_ACCES');
    if (target !== me && !admin) throw new ForbiddenException();
    if (target === me && !admin && !permissions.has('TEMPS_SAISIR')) throw new ForbiddenException();
    return this.service.timesheet(target, q.From, q.To);
  }
}

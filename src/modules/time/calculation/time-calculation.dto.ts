import { IsBoolean, IsDateString, IsIn, IsOptional, IsUUID } from 'class-validator';

export class PeriodDto {
  @IsDateString()
  From!: string;

  @IsDateString()
  To!: string;
}

export class CalculateOvertimeDto extends PeriodDto {
  @IsOptional()
  @IsIn(['daily', 'weekly'])
  Method?: 'daily' | 'weekly';
}

export class CalculateDailyHoursDto extends PeriodDto {
  // Retire la pause du temps travaille (le systeme Pointage ne le fait pas).
  @IsOptional()
  @IsBoolean()
  DeductBreak?: boolean;

  // Compte les jours sans horaire mais pointes (dimanche) avec 0 h prevue.
  @IsOptional()
  @IsBoolean()
  IncludeNonWorkingDays?: boolean;
}

export class TimesheetQueryDto extends PeriodDto {
  @IsOptional()
  @IsUUID()
  EmployeeId?: string;
}

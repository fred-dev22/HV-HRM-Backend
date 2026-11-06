import { Type } from 'class-transformer';
import { IsBoolean, IsDateString, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';

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

  // Mode par code : ne recalcule que ce code de paie (ex. HS10), les autres codes de la periode restent intacts.
  @IsOptional()
  @IsString()
  @MaxLength(20)
  Code?: string;
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

// Feuilles de temps de plusieurs employes (globale ou equipe) : recherche et
// pagination faites par le serveur.
export class TimesheetListQueryDto extends PeriodDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  Search?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  Page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  PageSize?: number;
}

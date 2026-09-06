import { Type } from 'class-transformer';
import { IsBoolean, IsDate, IsIn, IsOptional } from 'class-validator';

export class CalendarWorkDayDto {
  @IsIn(['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'])
  DayOfWeek: string;

  @IsBoolean()
  IsEnabled: boolean;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  StartTime?: Date;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  EndTime?: Date;

  @IsOptional()
  @IsBoolean()
  BreakEnabled?: boolean;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  BreakStartTime?: Date;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  BreakEndTime?: Date;
}

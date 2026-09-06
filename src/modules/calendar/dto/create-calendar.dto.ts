import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { CalendarWorkDayDto } from './calendar-work-day.dto';

export class CreateCalendarDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  Name: string;

  @IsOptional()
  @IsBoolean()
  IsDefault?: boolean;

  // Absent/null = calendrier global. Une catégorie n'a jamais plus d'un
  // calendrier dédié (contrainte @unique en base, voir schema.prisma).
  @IsOptional()
  @IsUUID()
  EmployeeCategoryId?: string;

  // Exactly one row per day of the week (Monday..Sunday) — the frontend
  // always sends the full week, replaced atomically on update.
  @ValidateNested({ each: true })
  @Type(() => CalendarWorkDayDto)
  @ArrayMinSize(7)
  @ArrayMaxSize(7)
  WorkDays: CalendarWorkDayDto[];
}

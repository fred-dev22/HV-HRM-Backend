import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsUUID, ValidateNested } from 'class-validator';
import { CalendarWorkDayDto } from './calendar-work-day.dto';

// Une meme semaine d'horaires donnee en propre a plusieurs employes.
export class ApplyCalendarToEmployeesDto {
  @ArrayMinSize(1)
  @ArrayMaxSize(1000)
  @ArrayUnique()
  @IsUUID(undefined, { each: true })
  EmployeeIds: string[];

  @ValidateNested({ each: true })
  @Type(() => CalendarWorkDayDto)
  @ArrayMinSize(7)
  @ArrayMaxSize(7)
  WorkDays: CalendarWorkDayDto[];
}

import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDate,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export class CreateHolidayDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  Name: string;

  @Type(() => Date)
  @IsDate()
  Date: Date;

  @IsOptional()
  @IsBoolean()
  IsRecurring?: boolean;

  @IsIn(['National', 'Local'])
  HolidayType: string;

  @IsOptional()
  @IsUUID()
  OrganizationUnitId?: string;

  // Ciblage d'eligibilite (demande client, 01/09) : absent/non fourni =
  // s'applique a tout le monde sur ce critere. Meme mecanisme que sur
  // LeaveType (voir common/utils/eligibility.util.ts).
  @IsOptional()
  @IsIn(['M', 'F'])
  AppliesToGender?: string;

  @IsOptional()
  @IsBoolean()
  AppliesToExpatriate?: boolean;
}

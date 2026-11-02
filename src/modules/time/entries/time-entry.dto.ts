import { Type } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export const TIME_ENTRY_TYPES = [
  'mission',
  'reunion_exterieure',
  'travail_hors_site',
  'travail_sur_site',
  'permanence',
  'panier',
] as const;

export class CreateTimeEntryDto {
  // Absent = pour soi-meme. Pour un autre employe : TEMPS_ACCES requis.
  @IsOptional()
  @IsUUID()
  EmployeeId?: string;

  @IsDateString()
  Date!: string;

  // Heures declarees (un panier ou une permanence compte 1 par jour).
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(24)
  Hours!: number;

  @IsIn(TIME_ENTRY_TYPES)
  EntryType!: (typeof TIME_ENTRY_TYPES)[number];

  @IsOptional()
  @IsString()
  @MaxLength(500)
  Comments?: string;
}

export class UpdateTimeEntryDto {
  @IsOptional()
  @IsDateString()
  Date?: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(24)
  Hours?: number;

  @IsOptional()
  @IsIn(TIME_ENTRY_TYPES)
  EntryType?: (typeof TIME_ENTRY_TYPES)[number];

  @IsOptional()
  @IsString()
  @MaxLength(500)
  Comments?: string;
}

export class DecideTimeEntryDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  Comment?: string;
}

export class QueryTimeEntriesDto {
  @IsOptional()
  @IsUUID()
  EmployeeId?: string;

  @IsOptional()
  @IsIn(['Pending', 'Approved', 'Rejected', 'Cancelled'])
  Status?: string;

  @IsOptional()
  @IsIn(TIME_ENTRY_TYPES)
  EntryType?: string;

  @IsOptional()
  @IsDateString()
  From?: string;

  @IsOptional()
  @IsDateString()
  To?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  Page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  Limit?: number;
}

import { Type } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

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

  // Heures declarees (un panier ou une permanence compte 1 par jour). Facultatif
  // si l'heure de debut et de fin sont donnees : la duree s'en deduit.
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(24)
  Hours?: number;

  // Heure de debut et de fin de la journee declaree (HH:mm).
  @IsOptional()
  @Matches(TIME_PATTERN, { message: 'Heure de début au format HH:mm' })
  StartTime?: string;

  @IsOptional()
  @Matches(TIME_PATTERN, { message: 'Heure de fin au format HH:mm' })
  EndTime?: string;

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
  @Matches(TIME_PATTERN, { message: 'Heure de début au format HH:mm' })
  StartTime?: string;

  @IsOptional()
  @Matches(TIME_PATTERN, { message: 'Heure de fin au format HH:mm' })
  EndTime?: string;

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

  // Recherche libre : nom ou matricule de l'employe, commentaire.
  @IsOptional()
  @IsString()
  @MaxLength(100)
  Search?: string;

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

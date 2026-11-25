import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
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

// Saisie en lot (RH) : le meme element pour plusieurs employes, sur les jours de
// semaine choisis d'une periode.
export class CreateTimeEntryBatchDto {
  @IsArray()
  @ArrayNotEmpty({ message: 'Choisissez au moins un employé' })
  @ArrayMaxSize(200, { message: 'Pas plus de 200 employés par saisie en lot' })
  @IsUUID('all', { each: true })
  EmployeeIds!: string[];

  @IsDateString()
  From!: string;

  @IsDateString()
  To!: string;

  // Jours de semaine retenus : 0 = dimanche ... 6 = samedi.
  @IsArray()
  @ArrayNotEmpty({ message: 'Choisissez au moins un jour de la semaine' })
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  Weekdays!: number[];

  @IsOptional()
  @IsBoolean()
  IncludeHolidays?: boolean;

  @IsIn(TIME_ENTRY_TYPES)
  EntryType!: (typeof TIME_ENTRY_TYPES)[number];

  // Ignores pour un panier ou une permanence (1 par jour).
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
  @IsString()
  @MaxLength(500)
  Comments?: string;

  // true : controle seulement, rien n'est cree.
  @IsOptional()
  @IsBoolean()
  DryRun?: boolean;
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

// Ajustement des heures par un validateur : duree, ou heure de debut et de fin.
export class AdjustTimeEntryDto {
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
  @IsString()
  @MaxLength(400)
  Comment?: string;
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

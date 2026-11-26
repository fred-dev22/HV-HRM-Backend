import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const TIME_MESSAGE = { message: 'Heure au format HH:mm attendue' };

export class WeekQueryDto {
  // Un jour de la semaine voulue ; le serveur prend son lundi.
  @IsDateString()
  WeekStart!: string;
}

export class WeekListQueryDto extends WeekQueryDto {
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

export class WeekPunchDto {
  @IsOptional()
  @Matches(TIME, TIME_MESSAGE)
  Start?: string;

  @IsOptional()
  @Matches(TIME, TIME_MESSAGE)
  End?: string;

  @IsOptional()
  @IsBoolean()
  NextDay?: boolean;
}

// Un jour corrige. Un champ absent n'est pas modifie ; une liste de pointages
// vide retire les heures du jour.
export class WeekDayDto {
  @IsDateString()
  Date!: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(6, { message: 'Pas plus de 6 périodes par jour' })
  @ValidateNested({ each: true })
  @Type(() => WeekPunchDto)
  Punches?: WeekPunchDto[];

  @IsOptional()
  @IsBoolean()
  Panier?: boolean;

  @IsOptional()
  @IsBoolean()
  Permanence?: boolean;
}

export class SaveWeekDto extends WeekQueryDto {
  @IsArray()
  @ArrayNotEmpty({ message: 'Aucune modification à enregistrer' })
  @ArrayMaxSize(7)
  @ValidateNested({ each: true })
  @Type(() => WeekDayDto)
  Days!: WeekDayDto[];

  @IsOptional()
  @IsString()
  @MaxLength(300)
  Comment?: string;
}

export class ReopenWeekDto extends WeekQueryDto {
  @IsString()
  @MaxLength(300)
  Comment!: string;
}

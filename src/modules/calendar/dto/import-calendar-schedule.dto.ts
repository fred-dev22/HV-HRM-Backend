import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { WEEK_DAYS } from '../calendar-schedule-import';

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

// Un horaire (jours, heures, pause) a appliquer au calendrier global, d'une
// categorie ou d'un employe. Utilise par l'import Excel/CSV des horaires : le
// calendrier est cree s'il n'existe pas, sinon seuls les jours indiques changent.
export class ImportCalendarScheduleDto {
  @IsIn(['global', 'category', 'employee'])
  Scope!: 'global' | 'category' | 'employee';

  // Obligatoire pour une categorie (son code) ou un employe (son matricule). Le code et
  // le matricule sont uniques en base : jamais deux cibles pour une meme valeur.
  @IsOptional()
  @IsString()
  @MaxLength(20)
  TargetCode?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(7)
  @IsIn(WEEK_DAYS as unknown as string[], { each: true })
  Days!: string[];

  @IsBoolean()
  IsEnabled!: boolean;

  @IsOptional()
  @Matches(TIME_PATTERN, { message: 'Heure de début au format HH:mm' })
  StartTime?: string;

  @IsOptional()
  @Matches(TIME_PATTERN, { message: 'Heure de fin au format HH:mm' })
  EndTime?: string;

  @IsOptional()
  @Matches(TIME_PATTERN, { message: 'Début de pause au format HH:mm' })
  BreakStartTime?: string;

  @IsOptional()
  @Matches(TIME_PATTERN, { message: 'Fin de pause au format HH:mm' })
  BreakEndTime?: string;
}

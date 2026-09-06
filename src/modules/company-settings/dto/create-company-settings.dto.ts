import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateCompanySettingsDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  CompanyName: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(3)
  Currency: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  Timezone: string;

  @IsIn(['WorkingDays', 'CalendarDays'])
  DayCountingRule: string;

  @IsNumber()
  DefaultMonthlyAccrualRate: number;

  @IsInt()
  @Min(0)
  DefaultCarryOverCap: number;

  // Jour du mois (1-28) où tourne la génération automatique des acquisitions
  // de congés — optionnel, génération manuelle uniquement tant que non défini.
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(28)
  LeaveAccrualRunDay?: number;

  // Derniere portee consultee dans Configuration > Calendrier (Global ou
  // Categorie) — persistee ici (et non cote navigateur) pour que n'importe
  // quel admin, sur n'importe quel poste, retrouve l'etat laisse.
  @IsOptional()
  @IsIn(['Global', 'Category'])
  CalendarConfigScope?: string;

  @IsOptional()
  @IsUUID()
  CalendarConfigCategoryId?: string;
}

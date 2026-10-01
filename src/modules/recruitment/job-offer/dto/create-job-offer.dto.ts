import { IsBoolean, IsInt, IsNotEmpty, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';

export class CreateJobOfferDto {
  @IsOptional()
  @IsUUID()
  HiringRequestId?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  Title: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  EntityName: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  ContractType: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  Location: string;

  @IsString()
  @IsNotEmpty()
  Description: string;

  // Grille d'evaluation d'entretien rattachee (US15) — optionnelle.
  @IsOptional()
  @IsUUID()
  InterviewEvaluationTemplateId?: string;

  // Retirer cette offre des flux publics /public/careers/feed.* (poste confidentiel).
  @IsOptional()
  @IsBoolean()
  ExcludeFromFeed?: boolean;

  // Remuneration affichee dans les flux et le contenu a partager (texte libre).
  @IsOptional()
  @IsString()
  @MaxLength(120)
  SalaryText?: string;

  // Periode d'essai par defaut de ce poste (retour client du 19/09) : remonte
  // automatiquement dans le contrat genere depuis une candidature a cette
  // offre, modifiable au cas par cas a l'acceptation (voir ContractService.accept).
  @IsOptional()
  @IsBoolean()
  TrialPeriodEnabled?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(24)
  TrialPeriodMonths?: number;
}

import { PartialType } from '@nestjs/mapped-types';
import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import {
  DISTRIBUTION_CHANNEL_KINDS,
  JOB_OFFER_DISTRIBUTION_STATUSES,
} from '../../recruitment.constants';

// DTO de la diffusion multi-plateformes. Noms de champs en PascalCase =
// colonnes Prisma (convention du module). La validation fine de TargetUrl
// (SSRF / boucle locale) est faite dans le service via isAllowedWebhookUrl
// pour renvoyer un message francais coherent.
export class CreateDistributionChannelDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  Name: string;

  @IsIn(DISTRIBUTION_CHANNEL_KINDS as unknown as string[])
  Kind: string;

  // Obligatoire uniquement pour un canal Webhook.
  @ValidateIf((o) => o.Kind === 'Webhook')
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  TargetUrl?: string;

  // Obligatoire uniquement pour un canal Email.
  @ValidateIf((o) => o.Kind === 'Email')
  @IsEmail()
  @MaxLength(150)
  TargetEmail?: string;

  // Secret partage : chaine vide => effacer, absent => inchange (voir service).
  @ValidateIf((o) => o.Secret !== undefined && o.Secret !== '')
  @IsString()
  @MinLength(8)
  @MaxLength(200)
  Secret?: string;

  @IsOptional()
  @IsBoolean()
  IsActive?: boolean;
}

export class UpdateDistributionChannelDto extends PartialType(CreateDistributionChannelDto) {}

// PATCH d'une ligne de suivi : le RH colle l'URL de l'annonce en ligne
// et/ou ajuste le statut apres une publication manuelle.
export class UpdateJobOfferDistributionDto {
  @IsOptional()
  @IsIn(JOB_OFFER_DISTRIBUTION_STATUSES as unknown as string[])
  Status?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  ExternalUrl?: string;
}

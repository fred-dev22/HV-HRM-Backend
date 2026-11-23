import { IsBoolean, IsEmail, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

// Enregistrement de la configuration d'envoi. Les champs propres a l'autre mode
// sont ignores. Un secret laisse vide conserve celui deja enregistre : l'ecran
// ne le relit jamais, il ne peut donc pas le renvoyer.
export class SaveMailSettingsDto {
  @IsIn(['Graph', 'Smtp'], { message: 'Le mode doit être Graph ou Smtp' })
  provider!: 'Graph' | 'Smtp';

  @IsEmail({}, { message: "L'adresse expéditrice n'est pas valide" })
  @MaxLength(200)
  sender!: string;

  @IsOptional() @IsString() @MaxLength(100) graphTenantId?: string;
  @IsOptional() @IsString() @MaxLength(100) graphClientId?: string;
  @IsOptional() @IsString() @MaxLength(500) graphClientSecret?: string;

  @IsOptional() @IsString() @MaxLength(200) smtpHost?: string;
  @IsOptional() @IsInt() @Min(1) @Max(65535) smtpPort?: number;
  @IsOptional() @IsBoolean() smtpSecure?: boolean;
  // false = serveur sans authentification (relais interne) : identifiant et mot de passe effaces.
  @IsOptional() @IsBoolean() smtpAuth?: boolean;
  @IsOptional() @IsString() @MaxLength(200) smtpUser?: string;
  @IsOptional() @IsString() @MaxLength(500) smtpPassword?: string;
}

export class SendTestMailDto {
  @IsEmail({}, { message: "L'adresse du destinataire n'est pas valide" })
  to!: string;
}

import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

// Enregistrement de la configuration de stockage. Les champs de l'autre mode sont
// ignores. Un secret laisse vide conserve celui deja enregistre : l'ecran ne le
// relit jamais.
export class SaveStorageSettingsDto {
  @IsIn(['Local', 'Graph'], { message: 'Le mode doit être Local ou Graph' })
  provider!: 'Local' | 'Graph';

  // Chemin absolu du dossier du serveur.
  @IsOptional() @IsString() @MaxLength(500) localPath?: string;

  @IsOptional() @IsString() @MaxLength(100) graphTenantId?: string;
  @IsOptional() @IsString() @MaxLength(100) graphClientId?: string;
  @IsOptional() @IsString() @MaxLength(500) graphClientSecret?: string;
  @IsOptional() @IsString() @MaxLength(200) graphSiteHost?: string;
  @IsOptional() @IsString() @MaxLength(200) graphSitePath?: string;
  @IsOptional() @IsString() @MaxLength(300) graphUploadPath?: string;
}

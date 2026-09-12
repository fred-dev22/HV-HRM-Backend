import { IsIn, IsOptional } from 'class-validator';

// Envoi multipart : les champs texte arrivent en chaine. forbidNonWhitelisted
// (ValidationPipe global) rejette tout autre champ que ceux declares ici.
export class UploadApplicationDocumentDto {
  // 'true' => le fichier televerse devient le CV principal de la candidature.
  @IsOptional()
  @IsIn(['true', 'false'])
  setPrimaryCv?: string;
}

import { IsDateString, IsOptional } from 'class-validator';

// Fenetre de recherche des echeances. Champs PascalCase (convention repo) ;
// `whitelist` + `forbidNonWhitelisted` du ValidationPipe global rejettent
// tout parametre inconnu et toute valeur non-date avec un 400.
export class RemindersRangeDto {
  @IsOptional()
  @IsDateString()
  From?: string;

  @IsOptional()
  @IsDateString()
  To?: string;
}

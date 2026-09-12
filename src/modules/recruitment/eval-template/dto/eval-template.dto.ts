import { ArrayMinSize, IsArray, IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { PartialType } from '@nestjs/mapped-types';

// Grille d'evaluation d'entretien (US15) : un nom + une liste ordonnee de
// criteres (chacun note /5 au moment de l'evaluation).
export class CreateEvalTemplateDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  Name: string;

  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  Criteria: string[];
}

export class UpdateEvalTemplateDto extends PartialType(CreateEvalTemplateDto) {}

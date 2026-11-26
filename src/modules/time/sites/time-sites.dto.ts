import { PartialType } from '@nestjs/mapped-types';
import { ArrayMaxSize, IsArray, IsInt, IsNotEmpty, IsString, IsUUID, Matches, Max, MaxLength, Min } from 'class-validator';

export class CreateTimeSiteDto {
  // Utilise par l'import des employes : lettres, chiffres, tiret ou souligne.
  @Matches(/^[A-Za-z0-9_-]{1,20}$/, { message: 'Code : 20 caractères au plus, lettres, chiffres, - ou _' })
  Code!: string;

  @IsString()
  @IsNotEmpty({ message: 'Le nom du site est requis' })
  @MaxLength(100)
  Name!: string;

  // Minutes retirees a l'arrivee ET au depart.
  @IsInt()
  @Min(0)
  @Max(120, { message: 'Entre 0 et 120 minutes' })
  DeductionMinutes!: number;
}

export class UpdateTimeSiteDto extends PartialType(CreateTimeSiteDto) {}

export class SetSiteEmployeesDto {
  @IsArray()
  @ArrayMaxSize(1000)
  @IsUUID('all', { each: true })
  EmployeeIds!: string[];
}

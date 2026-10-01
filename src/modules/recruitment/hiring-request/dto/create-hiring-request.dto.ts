import { IsInt, IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength, Min } from 'class-validator';

export class CreateHiringRequestDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  PositionTitle: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  EntityName: string;

  @IsInt()
  @Min(1)
  Headcount: number;

  @IsString()
  @IsNotEmpty()
  Profile: string;

  // Poste existant du referentiel (optionnel). null (en modification) le
  // detache : la demande repasse en poste libre.
  @IsOptional()
  @IsUUID()
  PositionId?: string | null;

  // Beneficiaire reel de la demande si different du createur (retour client
  // du 19/09 : un assistant peut exprimer un besoin pour son directeur).
  // Omis ou null = la demande reste au nom du createur.
  @IsOptional()
  @IsUUID()
  RequestedForEmployeeId?: string | null;
}

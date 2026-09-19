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
}

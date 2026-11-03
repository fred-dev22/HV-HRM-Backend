import { IsNumber, IsOptional, IsString, Matches, MaxLength, Min, MinLength } from 'class-validator';

export class UpdateTimeSettingDto {
  @IsNumber()
  @Min(0)
  Value!: number;
}

export class UpdateTimeTypeDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  Name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  Description?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  SageTypeCode?: number;
}

const CODE_PATTERN = /^[A-Za-z0-9_-]{2,20}$/;

export class CreateTimeCodeDto {
  @Matches(CODE_PATTERN, { message: 'Le code doit faire 2 à 20 caractères (lettres, chiffres, - ou _)' })
  Code!: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  Description?: string;
}

export class UpdateTimeCodeDto {
  @IsOptional()
  @Matches(CODE_PATTERN, { message: 'Le code doit faire 2 à 20 caractères (lettres, chiffres, - ou _)' })
  Code?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  Description?: string;
}

export class UpdatePermanenceRateDto {
  @IsNumber()
  @Min(0)
  Amount!: number;
}

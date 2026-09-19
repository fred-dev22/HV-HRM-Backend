import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';
import { PartialType } from '@nestjs/mapped-types';

export class GenerateContractDto {
  @IsUUID()
  ApplicationId: string;

  @IsOptional()
  @IsUUID()
  TemplateId?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  JobTitle: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  EntityName: string;

  @IsDateString()
  StartDate: string;

  @IsOptional()
  @IsDateString()
  EndDate?: string;

  @IsNumber()
  @Min(0)
  Salary: number;
}

// La generation fige le candidat / l'entite depuis la candidature : seuls
// les champs modifiables avant l'envoi sont acceptes au PATCH.
export class UpdateContractDto {
  @IsOptional()
  @IsUUID()
  TemplateId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  JobTitle?: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  EntityName?: string;

  @IsOptional()
  @IsDateString()
  StartDate?: string;

  @IsOptional()
  @IsDateString()
  EndDate?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  Salary?: number;
}

export class NegotiateContractDto {
  @IsIn(['HR', 'Candidate'])
  FromParty: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  Amount?: number;

  @IsString()
  @IsNotEmpty()
  Comment: string;
}

// Acceptation d'une proposition. La periode d'essai n'est PAS automatique :
// tout le monde n'en a pas une, le RH choisit a l'acceptation. Corps absent ou
// WithTrial omis = pas de periode d'essai.
export class AcceptContractDto {
  @IsOptional()
  @IsBoolean()
  WithTrial?: boolean;
}

export class RefuseContractDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  RejectionReason: string;
}

export class ContractTemplateDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  Name: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  ContractType: string;

  @IsString()
  @IsNotEmpty()
  Content: string;
}

export class UpdateContractTemplateDto extends PartialType(ContractTemplateDto) {}

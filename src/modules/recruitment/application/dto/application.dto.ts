import {
  IsArray,
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { PartialType } from '@nestjs/mapped-types';
import { APPLICATION_SOURCES, APPLICATION_STATUSES } from '../../recruitment.constants';

// Enregistrement d'une candidature cote RH (candidature spontanee recue par
// un autre canal, saisie manuelle...). Le depot public passe par le
// controleur public, celui-ci exige RECRUTEMENT_ACCES.
export class CreateApplicationDto {
  @IsOptional()
  @IsUUID()
  JobOfferId?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  CandidateName: string;

  @IsEmail()
  CandidateEmail: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  CandidatePhone: string;

  @IsIn(APPLICATION_SOURCES as unknown as string[])
  Source: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  CvFileName?: string;
}

export class UpdateApplicationDto extends PartialType(CreateApplicationDto) {}

export class SetApplicationStatusDto {
  @IsIn(APPLICATION_STATUSES as unknown as string[])
  Status: string;
}

export class AddApplicationNoteDto {
  @IsString()
  @IsNotEmpty()
  Text: string;
}

export class AddToTalentPoolDto {
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  Tags?: string[];

  @IsOptional()
  @IsString()
  Notes?: string;
}

export class SelfApplyDto {
  @IsUUID()
  JobOfferId: string;
}

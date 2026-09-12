import {
  IsArray,
  IsEmail,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { PartialType } from '@nestjs/mapped-types';

export class CreateTalentPoolDto {
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

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  Tags?: string[];

  @IsOptional()
  @IsString()
  Notes?: string;

  @IsOptional()
  @IsUUID()
  SourceApplicationId?: string;
}

export class UpdateTalentPoolDto extends PartialType(CreateTalentPoolDto) {}

export class AddTalentPoolEvaluationDto {
  @IsInt()
  @Min(0)
  @Max(5)
  Score: number;

  @IsString()
  @IsNotEmpty()
  Comment: string;
}

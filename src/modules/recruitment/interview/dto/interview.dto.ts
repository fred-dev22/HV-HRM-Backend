import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsEmail,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { PartialType } from '@nestjs/mapped-types';
import { INTERVIEW_MODES } from '../../recruitment.constants';

export class InterviewParticipantDto {
  @IsOptional()
  @IsUUID()
  EmployeeId?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  Name: string;

  @IsOptional()
  @IsEmail()
  Email?: string;
}

export class ScheduleInterviewDto {
  @IsUUID()
  ApplicationId: string;

  @IsDateString()
  ScheduledAt: string;

  @IsIn(INTERVIEW_MODES as unknown as string[])
  Mode: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  Location?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  MeetingLink?: string;

  @IsOptional()
  @IsInt()
  @Min(15)
  @Max(480)
  DurationMinutes?: number;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => InterviewParticipantDto)
  Participants: InterviewParticipantDto[];
}

export class UpdateInterviewDto extends PartialType(ScheduleInterviewDto) {}

export class InterviewCriterionScoreDto {
  @IsString()
  @IsNotEmpty()
  Label: string;

  @IsInt()
  @Min(0)
  @Max(5)
  Score: number;
}

export class EvaluateInterviewDto {
  // Note globale /5 — requise si aucune grille (CriteriaScores) n'est fournie,
  // sinon calculee comme la moyenne des criteres.
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(5)
  Score?: number;

  @IsString()
  @IsNotEmpty()
  Comment: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  InterviewerName?: string;

  @IsOptional()
  @IsUUID()
  TemplateId?: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => InterviewCriterionScoreDto)
  CriteriaScores?: InterviewCriterionScoreDto[];
}

import { PartialType } from '@nestjs/mapped-types';
import {
  IsDateString,
  IsEmail,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { COURSE_STATUSES, PROVIDER_STATUSES, SESSION_MODES } from '../training.constants';

// Les champs de ce module sont en camelCase (reponses ET corps de requete) :
// les reponses reprennent exactement les types du frontend
// (src/stores/training/types.ts), contrairement au module Recrutement qui
// renvoie des lignes PascalCase.

// ── Prestataires ────────────────────────────────────────────────
export class CreateProviderDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  name: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  contactName: string;

  @IsEmail()
  @MaxLength(150)
  email: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  phone: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  specialties?: string;
}

export class UpdateProviderDto extends PartialType(CreateProviderDto) {
  @IsOptional()
  @IsIn(PROVIDER_STATUSES)
  status?: string;
}

export class EvaluateProviderDto {
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(5)
  score: number;
}

// ── Catalogue ───────────────────────────────────────────────────
export class CreateCourseDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  category: string;

  @IsString()
  @IsNotEmpty()
  description: string;

  @IsInt()
  @Min(1)
  @Max(1000)
  durationHours: number;

  @IsInt()
  @Min(1)
  @Max(10000)
  maxParticipants: number;

  @IsOptional()
  @IsUUID()
  providerId?: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  budgetAllocated: number;
}

export class UpdateCourseDto extends PartialType(CreateCourseDto) {
  @IsOptional()
  @IsIn(COURSE_STATUSES)
  status?: string;
}

// ── Sessions ────────────────────────────────────────────────────
export class CreateSessionDto {
  @IsUUID()
  courseId: string;

  @IsDateString()
  scheduledAt: string;

  @IsDateString()
  endAt: string;

  @IsIn(SESSION_MODES)
  mode: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  location?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  meetingLink?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  trainerName: string;

  @IsInt()
  @Min(1)
  @Max(10000)
  capacity: number;
}

// ── Inscriptions ────────────────────────────────────────────────
export class CreateEnrollmentDto {
  @IsUUID()
  sessionId: string;

  @IsUUID()
  employeeId: string;
}

// Evaluation a chaud ou a froid. `date` (AAAA-MM-JJ) vaut aujourd'hui si omise.
export class SubmitEvaluationDto {
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(5)
  score: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  comment: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'La date doit être au format AAAA-MM-JJ' })
  date?: string;
}

// ── Budget ──────────────────────────────────────────────────────
export class CreateBudgetLineDto {
  @IsInt()
  @Min(2000)
  @Max(2100)
  year: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  entityName: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  courseTitle?: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  allocated: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  comment?: string;
}

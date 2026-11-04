import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsDateString, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';

export class UpdateMorphoConfigDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  FolderPath?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  CronSchedule?: string;

  @IsOptional()
  @IsBoolean()
  IsScheduleActive?: boolean;
}

class PageDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  Page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  Limit?: number;
}

export class QueryMorphoImportsDto extends PageDto {
  @IsOptional()
  @IsIn(['Pending', 'Processing', 'Completed', 'Failed'])
  Status?: string;
}

export class QueryMorphoRecordsDto extends PageDto {
  @IsOptional()
  @IsUUID()
  EmployeeId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  EmployeeNumber?: string;

  @IsOptional()
  @IsUUID()
  ImportId?: string;

  @IsOptional()
  @IsDateString()
  From?: string;

  @IsOptional()
  @IsDateString()
  To?: string;

  // "true" : uniquement les lignes sans employe rapproche.
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  UnmatchedOnly?: boolean;
}

// Rattachement manuel d'une personne de la pointeuse a un employe du HRM.
export class LinkMorphoPersonDto {
  @IsString()
  @MaxLength(100)
  BiometricUuid!: string;

  @IsUUID()
  EmployeeId!: string;
}

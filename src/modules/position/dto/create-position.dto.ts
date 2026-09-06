import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  MaxLength,
} from 'class-validator';

export class CreatePositionDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  Code: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  Title: string;

  @IsUUID()
  JobId: string;

  @IsOptional()
  @IsUUID()
  OrganizationUnitId?: string;

  @IsOptional()
  @IsUUID()
  ParentPositionId?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  Capacity?: number;
}

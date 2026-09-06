import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class CreateJobDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  Code: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  Title: string;

  @IsOptional()
  @IsString()
  Description?: string;

  @IsOptional()
  @IsBoolean()
  IsActive?: boolean;
}

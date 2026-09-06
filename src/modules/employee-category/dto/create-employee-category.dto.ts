import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class CreateEmployeeCategoryDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  Code: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  Name: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  Description?: string;

  @IsOptional()
  @IsBoolean()
  IsActive?: boolean;
}

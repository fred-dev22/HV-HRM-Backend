import {
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class CreateExpenseTypeDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  Code: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  Name: string;

  @IsIn(['PerDay', 'PerTrip', 'PerItem'])
  Unit: string;

  @IsOptional()
  @IsBoolean()
  IsActive?: boolean;
}

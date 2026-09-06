import {
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  MaxLength,
} from 'class-validator';

export class CreateExpenseConfigDto {
  @IsUUID()
  EmployeeCategoryId: string;

  @IsUUID()
  ExpenseTypeId: string;

  @IsIn(['National', 'International'])
  MissionCategory: string;

  @IsNumber()
  @Min(0)
  DailyRate: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(3)
  Currency: string;

  @IsOptional()
  @IsBoolean()
  DocumentRequired?: boolean;

  @IsOptional()
  @IsBoolean()
  IsActive?: boolean;
}

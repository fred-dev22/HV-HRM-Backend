import {
  IsNotEmpty,
  IsNumber,
  IsString,
  IsUUID,
  Min,
  MaxLength,
} from 'class-validator';

export class CreateExpenseCeilingDto {
  @IsUUID()
  EmployeeCategoryId: string;

  @IsUUID()
  ExpenseTypeId: string;

  @IsNumber()
  @Min(0)
  MaxAmount: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(3)
  Currency: string;
}

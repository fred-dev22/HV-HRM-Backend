import { IsBoolean, IsDateString, IsNumber, IsOptional, IsString, IsUUID, Min } from 'class-validator';

export class CreateExpenseLineDto {
  @IsDateString()
  ExpenseDate: string;

  @IsUUID()
  ExpenseTypeId: string;

  @IsOptional()
  @IsString()
  Description?: string;

  @IsNumber()
  @Min(0)
  Amount: number;

  @IsOptional()
  @IsString()
  Currency?: string;

  @IsOptional()
  @IsBoolean()
  HasDocument?: boolean;
}

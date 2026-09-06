import { IsNumber, IsOptional, IsString, IsUUID, Min } from 'class-validator';

export class CreateMissionExpenseLineDto {
  @IsUUID()
  ExpenseTypeId: string;

  @IsOptional()
  @IsString()
  Description?: string;

  @IsNumber()
  @Min(0)
  Amount: number;
}

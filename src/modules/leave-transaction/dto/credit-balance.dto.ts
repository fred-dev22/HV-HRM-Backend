import { IsNotEmpty, IsNumber, IsOptional, IsString, IsUUID, MaxLength, NotEquals } from 'class-validator';

export class CreditBalanceDto {
  @IsUUID()
  EmployeeId: string;

  @IsUUID()
  LeaveTypeId: string;

  // Positif = crédit, négatif = décrément (plafonné à 0 en base, voir
  // LeaveTransactionService.adjustBalance) — 0 est refusé, ça ne serait pas
  // un mouvement.
  @IsNumber()
  @NotEquals(0)
  Amount: number;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  Reason?: string;
}

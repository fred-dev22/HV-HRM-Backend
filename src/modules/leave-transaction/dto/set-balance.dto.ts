import {
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  MaxLength,
} from 'class-validator';

// Fixe le solde a une valeur absolue (import des soldes initiaux, demande
// client confirmee le 08/09 sur WhatsApp avec Mamy — "remplacer" et non
// "ajouter") — distinct de CreditBalanceDto (credit ponctuel/ajustement
// manuel, delta relatif), voir LeaveTransactionService.setBalance.
export class SetBalanceDto {
  @IsUUID()
  EmployeeId: string;

  @IsUUID()
  LeaveTypeId: string;

  // Valeur cible absolue, jamais negative (contrairement au delta de
  // CreditBalanceDto qui peut etre negatif pour decrementer).
  @IsNumber()
  @Min(0, { message: 'Le solde ne peut pas être négatif.' })
  Amount: number;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  Reason?: string;
}

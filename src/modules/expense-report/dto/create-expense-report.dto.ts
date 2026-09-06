import { IsArray, IsNotEmpty, IsOptional, IsString, IsUUID, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { CreateExpenseLineDto } from './create-expense-line.dto';

export class CreateExpenseReportDto {
  // Optionnel : par defaut la note est creee pour l'utilisateur courant. Ne
  // peut etre forcee a un autre employe que si l'appelant a FRAIS_VOIR_TOUT
  // (ex: RH qui saisit une note recue par un autre canal).
  @IsOptional()
  @IsUUID()
  EmployeeId?: string;

  @IsString()
  @IsNotEmpty()
  Title: string;

  @IsOptional()
  @IsUUID()
  MissionOrderId?: string;

  @IsOptional()
  @IsString()
  Currency?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateExpenseLineDto)
  Lines?: CreateExpenseLineDto[];
}

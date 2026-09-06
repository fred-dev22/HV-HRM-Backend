import {
  IsArray,
  IsDateString,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { CreateMissionExpenseLineDto } from './create-mission-expense-line.dto';

const MISSION_CATEGORIES = ['National', 'International'];
const TRANSPORT_MODES = ['PersonalCar', 'CompanyCar', 'PublicTransport', 'Plane', 'Other'];

export class CreateMissionOrderDto {
  // Optionnel : par defaut l'ordre est cree pour l'utilisateur courant. Ne
  // peut etre force a un autre employe que si l'appelant a MISSION_VOIR_TOUT
  // (ex: RH qui saisit un ordre pour un employe sans acces au systeme).
  @IsOptional()
  @IsUUID()
  EmployeeId?: string;

  @IsString()
  @IsNotEmpty()
  Destination: string;

  @IsIn(MISSION_CATEGORIES)
  MissionCategory: string;

  @IsString()
  @IsNotEmpty()
  Purpose: string;

  @IsDateString()
  DepartureDate: string;

  @IsDateString()
  ReturnDate: string;

  @IsIn(TRANSPORT_MODES)
  TransportModeGo: string;

  @IsIn(TRANSPORT_MODES)
  TransportModeReturn: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  AdvanceRequested?: number;

  @IsOptional()
  @IsString()
  Currency?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateMissionExpenseLineDto)
  ExpenseLines?: CreateMissionExpenseLineDto[];

  // Optionnel : mission accompagnant (plan de test #22, ex: le chauffeur
  // d'un directeur). Cree automatiquement un second ordre de mission, memes
  // dates/destination/categorie, pour cet employe.
  @IsOptional()
  @IsUUID()
  AssociatedEmployeeId?: string;
}

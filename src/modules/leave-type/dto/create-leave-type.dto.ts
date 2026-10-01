import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  MaxLength,
} from 'class-validator';

export class CreateLeaveTypeDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  Code: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  Name: string;

  @IsIn(['Standard', 'Medical'])
  WorkflowType: string;

  @IsOptional()
  @IsBoolean()
  MonthlyAccrual?: boolean;

  @IsNumber()
  @Min(0, { message: 'Le nombre de jours par an ne peut pas être négatif' })
  DaysPerYear: number;

  @IsOptional()
  @IsNumber()
  @Min(0, { message: "L'accumulation mensuelle ne peut pas être négative" })
  DaysPerMonth?: number;

  @IsOptional()
  @IsBoolean()
  DocumentRequired?: boolean;

  @IsOptional()
  @IsInt({
    message: 'Le délai de soumission doit être un nombre entier de jours',
  })
  @Min(1, { message: "Le délai de soumission doit être d'au moins 1 jour" })
  DocumentDeadlineDays?: number;

  @IsOptional()
  @IsBoolean()
  CarryOverAllowed?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  CarryOverCap?: number;

  @IsOptional()
  @IsInt({ message: 'Le préavis minimum doit être un nombre entier de jours' })
  @Min(0, { message: 'Le préavis minimum ne peut pas être négatif' })
  MinNoticeDays?: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  Color: string;

  @IsOptional()
  @IsBoolean()
  IsActive?: boolean;

  @IsOptional()
  @IsBoolean()
  IsSystem?: boolean;

  // Ciblage d'eligibilite (demande client, 01/09) : absent/non fourni =
  // s'applique a tout le monde sur ce critere. Meme mecanisme que sur
  // Holiday (voir common/utils/eligibility.util.ts).
  @IsOptional()
  @IsIn(['M', 'F'])
  AppliesToGender?: string;

  @IsOptional()
  @IsBoolean()
  AppliesToExpatriate?: boolean;

  @IsOptional()
  @IsUUID()
  OrganizationUnitId?: string;

  // Decompte calendaire (retour client, 08/09) : absent/false = jours ouvres
  // (comportement actuel, inchange). true = tous les jours du calendrier
  // comptent (weekends et feries inclus), voir LeaveTypeService et
  // LeaveRequestService.computeWorkingDays.
  @IsOptional()
  @IsBoolean()
  CountCalendarDays?: boolean;

  // Ne correspond à aucune colonne LeaveType — déclenche, une fois le type
  // créé, un crédit rétroactif aux employés déjà actifs (mois en cours si
  // accumulation mensuelle, année complète sinon). Voir LeaveTypeService.create.
  @IsOptional()
  @IsBoolean()
  CreditExistingEmployees?: boolean;
}

import { IsDateString, IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class CreateLeaveRequestDto {
  // Optionnel : par defaut la demande est creee pour l'utilisateur courant.
  // Ne peut etre force a un autre employe que si l'appelant a CONGE_VOIR_TOUT
  // (ex: RH qui saisit une demande recue par un autre canal).
  @IsOptional()
  @IsUUID()
  EmployeeId?: string;

  @IsUUID()
  LeaveTypeId: string;

  @IsDateString()
  StartDate: string;

  // full | am | pm — voir LeaveRequest.StartPeriod (schema.prisma).
  @IsOptional()
  @IsIn(['full', 'am', 'pm'])
  StartPeriod?: string;

  @IsDateString()
  EndDate: string;

  @IsOptional()
  @IsIn(['full', 'am', 'pm'])
  EndPeriod?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  Reason?: string;

  @IsOptional()
  @IsUUID()
  InterimEmployeeId?: string;
}

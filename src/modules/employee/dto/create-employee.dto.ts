import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDate,
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export class CreateEmployeeDto {
  // Optionnel : genere cote serveur si omis (voir EmployeeService.create) —
  // le frontend pre-remplit une suggestion mais l'admin peut la modifier.
  @IsOptional()
  @IsString()
  @MaxLength(20)
  EmployeeNumber?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  FirstName: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  LastName: string;

  @IsIn(['M', 'F'])
  Gender: string;

  @Type(() => Date)
  @IsDate()
  BirthDate: Date;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  BirthPlace?: string;

  @IsIn(['Single', 'Married', 'Divorced', 'Widowed'])
  MaritalStatus: string;

  @IsIn(['NationalId', 'Passport', 'ResidencePermit'])
  IdType: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  IdNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  MobilePhone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  WorkPhone?: string;

  @IsEmail()
  @MaxLength(150)
  Email: string;

  @IsIn(['Permanent', 'FixedTerm', 'Internship', 'Freelance', 'Apprenticeship', 'WorkStudy'])
  ContractType: string;

  @Type(() => Date)
  @IsDate()
  HireDate: Date;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  TerminationDate?: Date;

  @IsOptional()
  @IsUUID()
  PositionId?: string;

  @IsUUID()
  OrganizationUnitId: string;

  @IsOptional()
  @IsUUID()
  EmployeeCategoryId?: string;

  @IsIn(['Active', 'OnTrial', 'OnLeave', 'Inactive'])
  Status: string;

  // Regime de conges — voir Employee.IsExpatriate (schema.prisma).
  @IsOptional()
  @IsBoolean()
  IsExpatriate?: boolean;
}

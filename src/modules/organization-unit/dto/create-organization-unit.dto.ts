import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export class CreateOrganizationUnitDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  Code: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  Name: string;

  @IsIn(['Direction', 'Department', 'Service'])
  Type: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  LegalIdentifier?: string;

  @IsOptional()
  @IsUUID()
  ParentId?: string;

  @IsOptional()
  @IsUUID()
  ManagerId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  Address?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  Phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  Email?: string;

  @IsIn(['Draft', 'PendingApproval', 'Active', 'Inactive'])
  Status: string;
}

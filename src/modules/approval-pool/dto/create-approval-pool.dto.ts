import {
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export class CreateApprovalPoolDto {
  @IsUUID()
  OrganizationUnitId: string;

  @IsIn(['Leave', 'Mission', 'ExpenseReport'])
  ObjectType: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  Name: string;

  @IsOptional()
  @IsBoolean()
  IsActive?: boolean;
}

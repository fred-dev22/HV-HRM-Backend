import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDate,
  IsInt,
  IsOptional,
  IsUUID,
  Min,
} from 'class-validator';

export class CreateApprovalPoolMemberDto {
  @IsUUID()
  ApprovalPoolId: string;

  @IsInt()
  @Min(1)
  StepOrder: number;

  @IsUUID()
  EmployeeId: string;

  @IsOptional()
  @IsUUID()
  InterimEmployeeId?: string;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  InterimStartDate?: Date;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  InterimEndDate?: Date;

  @IsOptional()
  @IsBoolean()
  IsMandatory?: boolean;
}

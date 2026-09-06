import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class DecidePublicApprovalDto {
  @IsIn(['Approved', 'Rejected', 'Returned'])
  Decision: 'Approved' | 'Rejected' | 'Returned';

  @IsOptional()
  @IsString()
  @MaxLength(500)
  Comment?: string;
}

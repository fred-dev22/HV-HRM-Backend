import { IsOptional, IsString, MaxLength } from 'class-validator';

export class DecideExpenseReportDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  Comment?: string;
}

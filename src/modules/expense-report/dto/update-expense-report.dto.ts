import { PartialType, OmitType } from '@nestjs/mapped-types';
import { CreateExpenseReportDto } from './create-expense-report.dto';

export class UpdateExpenseReportDto extends PartialType(
  OmitType(CreateExpenseReportDto, ['EmployeeId'] as const),
) {}

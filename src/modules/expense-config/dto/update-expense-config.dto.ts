import { PartialType } from '@nestjs/mapped-types';
import { CreateExpenseConfigDto } from './create-expense-config.dto';

export class UpdateExpenseConfigDto extends PartialType(CreateExpenseConfigDto) {}

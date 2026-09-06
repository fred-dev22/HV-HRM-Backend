import { PartialType } from '@nestjs/mapped-types';
import { CreateExpenseTypeDto } from './create-expense-type.dto';

export class UpdateExpenseTypeDto extends PartialType(CreateExpenseTypeDto) {}

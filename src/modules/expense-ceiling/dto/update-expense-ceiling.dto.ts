import { PartialType } from '@nestjs/mapped-types';
import { CreateExpenseCeilingDto } from './create-expense-ceiling.dto';

export class UpdateExpenseCeilingDto extends PartialType(CreateExpenseCeilingDto) {}

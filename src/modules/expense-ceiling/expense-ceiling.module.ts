import { Module } from '@nestjs/common';
import { ExpenseCeilingController } from './expense-ceiling.controller';
import { ExpenseCeilingService } from './expense-ceiling.service';

@Module({
  controllers: [ExpenseCeilingController],
  providers: [ExpenseCeilingService],
  exports: [ExpenseCeilingService],
})
export class ExpenseCeilingModule {}

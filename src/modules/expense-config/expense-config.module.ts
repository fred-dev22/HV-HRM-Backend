import { Module } from '@nestjs/common';
import { ExpenseConfigController } from './expense-config.controller';
import { ExpenseConfigService } from './expense-config.service';

@Module({
  controllers: [ExpenseConfigController],
  providers: [ExpenseConfigService],
  exports: [ExpenseConfigService],
})
export class ExpenseConfigModule {}

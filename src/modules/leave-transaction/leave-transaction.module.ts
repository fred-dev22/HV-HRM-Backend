import { Module } from '@nestjs/common';
import { LeaveTransactionController } from './leave-transaction.controller';
import { LeaveTransactionService } from './leave-transaction.service';
import { AccrualSchedulerService } from './accrual-scheduler.service';
import { NotificationModule } from '../notification/notification.module';

@Module({
  imports: [NotificationModule],
  controllers: [LeaveTransactionController],
  providers: [LeaveTransactionService, AccrualSchedulerService],
  exports: [LeaveTransactionService],
})
export class LeaveTransactionModule {}

import { Module } from '@nestjs/common';
import { ExpenseReportController } from './expense-report.controller';
import { ExpenseReportService } from './expense-report.service';
import { ApprovalPoolModule } from '../approval-pool/approval-pool.module';
import { NotificationModule } from '../notification/notification.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { ExpenseCeilingModule } from '../expense-ceiling/expense-ceiling.module';

@Module({
  imports: [ApprovalPoolModule, NotificationModule, RealtimeModule, ExpenseCeilingModule],
  controllers: [ExpenseReportController],
  providers: [ExpenseReportService],
  exports: [ExpenseReportService],
})
export class ExpenseReportModule {}

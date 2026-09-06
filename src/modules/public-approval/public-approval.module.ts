import { Module } from '@nestjs/common';
import { PublicApprovalController } from './public-approval.controller';
import { PublicApprovalService } from './public-approval.service';
import { LeaveRequestModule } from '../leave-request/leave-request.module';
import { MissionOrderModule } from '../mission-order/mission-order.module';
import { ExpenseReportModule } from '../expense-report/expense-report.module';

@Module({
  imports: [LeaveRequestModule, MissionOrderModule, ExpenseReportModule],
  controllers: [PublicApprovalController],
  providers: [PublicApprovalService],
})
export class PublicApprovalModule {}

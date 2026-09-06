import { Module } from '@nestjs/common';
import { LeaveRequestController } from './leave-request.controller';
import { LeaveRequestService } from './leave-request.service';
import { ApprovalPoolModule } from '../approval-pool/approval-pool.module';
import { LeaveTransactionModule } from '../leave-transaction/leave-transaction.module';
import { NotificationModule } from '../notification/notification.module';
import { RealtimeModule } from '../realtime/realtime.module';

@Module({
  imports: [ApprovalPoolModule, LeaveTransactionModule, NotificationModule, RealtimeModule],
  controllers: [LeaveRequestController],
  providers: [LeaveRequestService],
  exports: [LeaveRequestService],
})
export class LeaveRequestModule {}

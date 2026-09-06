import { Module } from '@nestjs/common';
import { MissionOrderController } from './mission-order.controller';
import { MissionOrderService } from './mission-order.service';
import { ApprovalPoolModule } from '../approval-pool/approval-pool.module';
import { NotificationModule } from '../notification/notification.module';
import { RealtimeModule } from '../realtime/realtime.module';

@Module({
  imports: [ApprovalPoolModule, NotificationModule, RealtimeModule],
  controllers: [MissionOrderController],
  providers: [MissionOrderService],
  exports: [MissionOrderService],
})
export class MissionOrderModule {}

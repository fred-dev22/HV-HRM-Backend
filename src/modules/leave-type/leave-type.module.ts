import { Module } from '@nestjs/common';
import { LeaveTypeController } from './leave-type.controller';
import { LeaveTypeService } from './leave-type.service';
import { LeaveTransactionModule } from '../leave-transaction/leave-transaction.module';
import { RealtimeModule } from '../realtime/realtime.module';

@Module({
  imports: [LeaveTransactionModule, RealtimeModule],
  controllers: [LeaveTypeController],
  providers: [LeaveTypeService],
  exports: [LeaveTypeService],
})
export class LeaveTypeModule {}

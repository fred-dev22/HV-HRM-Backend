import { Module } from '@nestjs/common';
import { LeaveTypeController } from './leave-type.controller';
import { LeaveTypeService } from './leave-type.service';
import { LeaveTransactionModule } from '../leave-transaction/leave-transaction.module';

@Module({
  imports: [LeaveTransactionModule],
  controllers: [LeaveTypeController],
  providers: [LeaveTypeService],
  exports: [LeaveTypeService],
})
export class LeaveTypeModule {}

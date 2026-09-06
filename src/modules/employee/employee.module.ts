import { Module } from '@nestjs/common';
import { EmployeeController } from './employee.controller';
import { EmployeeService } from './employee.service';
import { LeaveTransactionModule } from '../leave-transaction/leave-transaction.module';
import { RealtimeModule } from '../realtime/realtime.module';

@Module({
  imports: [LeaveTransactionModule, RealtimeModule],
  controllers: [EmployeeController],
  providers: [EmployeeService],
  exports: [EmployeeService],
})
export class EmployeeModule {}

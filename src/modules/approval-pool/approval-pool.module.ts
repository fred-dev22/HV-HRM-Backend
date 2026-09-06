import { Module } from '@nestjs/common';
import { ApprovalPoolController } from './approval-pool.controller';
import { ApprovalPoolService } from './approval-pool.service';

@Module({
  controllers: [ApprovalPoolController],
  providers: [ApprovalPoolService],
  exports: [ApprovalPoolService],
})
export class ApprovalPoolModule {}

import { Module } from '@nestjs/common';
import { ApprovalPoolMemberController } from './approval-pool-member.controller';
import { ApprovalPoolMemberService } from './approval-pool-member.service';

@Module({
  controllers: [ApprovalPoolMemberController],
  providers: [ApprovalPoolMemberService],
  exports: [ApprovalPoolMemberService],
})
export class ApprovalPoolMemberModule {}

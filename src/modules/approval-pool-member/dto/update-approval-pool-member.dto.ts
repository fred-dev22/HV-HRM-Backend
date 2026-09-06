import { PartialType } from '@nestjs/mapped-types';
import { CreateApprovalPoolMemberDto } from './create-approval-pool-member.dto';

// ApprovalPoolMember has no ModifiedBy/ModifiedAt columns in the data model
// (append-only record) — updates only touch the mutable business fields.
export class UpdateApprovalPoolMemberDto extends PartialType(CreateApprovalPoolMemberDto) {}

import { PartialType } from '@nestjs/mapped-types';
import { CreateApprovalPoolDto } from './create-approval-pool.dto';

export class UpdateApprovalPoolDto extends PartialType(CreateApprovalPoolDto) {}

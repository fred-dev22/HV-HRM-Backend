import { PartialType, OmitType } from '@nestjs/mapped-types';
import { CreateOrganizationUnitDto } from './create-organization-unit.dto';

// LeaveApprovalMode volontairement exclu (voir create-organization-unit.dto.ts) :
// le PATCH generique ne doit jamais pouvoir le changer, seul l'endpoint dedie
// PATCH :id/leave-approval-mode le peut (voir SetLeaveApprovalModeDto).
export class UpdateOrganizationUnitDto extends PartialType(
  OmitType(CreateOrganizationUnitDto, ['LeaveApprovalMode'] as const),
) {}

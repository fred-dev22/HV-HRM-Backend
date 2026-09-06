import { OmitType, PartialType } from '@nestjs/mapped-types';
import { CreateLeaveRequestDto } from './create-leave-request.dto';

// EmployeeId n'est jamais modifiable apres creation.
export class UpdateLeaveRequestDto extends PartialType(
  OmitType(CreateLeaveRequestDto, ['EmployeeId'] as const),
) {}

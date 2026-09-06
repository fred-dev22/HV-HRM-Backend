import { PartialType, OmitType } from '@nestjs/mapped-types';
import { CreateMissionOrderDto } from './create-mission-order.dto';

export class UpdateMissionOrderDto extends PartialType(
  OmitType(CreateMissionOrderDto, ['EmployeeId'] as const),
) {}

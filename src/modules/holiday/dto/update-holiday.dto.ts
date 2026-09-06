import { PartialType } from '@nestjs/mapped-types';
import { CreateHolidayDto } from './create-holiday.dto';

// Holiday has no ModifiedBy/ModifiedAt columns in the data model
// (append-only record) — updates only touch the mutable business fields.
export class UpdateHolidayDto extends PartialType(CreateHolidayDto) {}

import { PartialType } from '@nestjs/mapped-types';
import { CreateOrganizationUnitDto } from './create-organization-unit.dto';

export class UpdateOrganizationUnitDto extends PartialType(CreateOrganizationUnitDto) {}

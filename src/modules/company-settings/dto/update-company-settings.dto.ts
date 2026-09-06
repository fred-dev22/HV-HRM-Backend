import { PartialType } from '@nestjs/mapped-types';
import { CreateCompanySettingsDto } from './create-company-settings.dto';

export class UpdateCompanySettingsDto extends PartialType(CreateCompanySettingsDto) {}

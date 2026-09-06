import { Body, Controller, Get, Patch, Post } from '@nestjs/common';
import { CompanySettingsService } from './company-settings.service';
import { CreateCompanySettingsDto } from './dto/create-company-settings.dto';
import { UpdateCompanySettingsDto } from './dto/update-company-settings.dto';
import { CompleteOnboardingDto } from './dto/complete-onboarding.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';

// Singleton resource: no :id route, no DELETE — matches the "one row, never
// inserted twice" rule from the data model.
@Controller('company-settings')
export class CompanySettingsController {
  constructor(private readonly service: CompanySettingsService) {}

  @Post()
  create(@Body() dto: CreateCompanySettingsDto) {
    return this.service.create(dto);
  }

  @Get()
  find() {
    return this.service.find();
  }

  @Patch()
  @RequirePermission('CONFIG_CALENDRIER')
  update(@Body() dto: UpdateCompanySettingsDto, @CurrentUser('employeeId') employeeId: string) {
    return this.service.update(dto, employeeId);
  }

  @Post('complete-onboarding')
  @RequirePermission('CONFIG_CALENDRIER')
  completeOnboarding(@Body() dto: CompleteOnboardingDto, @CurrentUser('employeeId') employeeId: string) {
    return this.service.completeOnboarding(dto, employeeId);
  }
}

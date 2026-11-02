import { Body, Controller, Get, Param, Patch } from '@nestjs/common';
import { RequireModule } from '../../../common/modules/require-module.decorator';
import { RequirePermission } from '../../../common/decorators/require-permission.decorator';
import { TimeSettingsService } from './time-settings.service';
import { UpdateTimeSettingDto } from './time-settings.dto';

@RequireModule('time')
@Controller('time/settings')
@RequirePermission('TEMPS_ACCES')
export class TimeSettingsController {
  constructor(private readonly service: TimeSettingsService) {}

  @Get()
  findAll() {
    return this.service.findAll();
  }

  @Get('codes')
  findCodes() {
    return this.service.findCodes();
  }

  @Get('permanence-rates')
  findPermanenceRates() {
    return this.service.findPermanenceRates();
  }

  @Patch(':key')
  update(@Param('key') key: string, @Body() dto: UpdateTimeSettingDto) {
    return this.service.update(key, dto.Value);
  }
}

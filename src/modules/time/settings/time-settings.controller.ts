import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { RequireModule } from '../../../common/modules/require-module.decorator';
import { RequirePermission } from '../../../common/decorators/require-permission.decorator';
import { TimeSettingsService } from './time-settings.service';
import { CreateTimeCodeDto, UpdatePermanenceRateDto, UpdateTimeCodeDto, UpdateTimeSettingDto, UpdateTimeTypeDto } from './time-settings.dto';

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

  // Catalogue edite par l'ecran "Types de presence" (codes verrouilles signales).
  @Get('types')
  findTypes() {
    return this.service.findTypes();
  }

  @Patch('types/:id')
  updateType(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateTimeTypeDto) {
    return this.service.updateType(id, dto);
  }

  @Post('types/:id/codes')
  createCode(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CreateTimeCodeDto) {
    return this.service.createCode(id, dto);
  }

  @Patch('codes/:id')
  updateCode(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateTimeCodeDto) {
    return this.service.updateCode(id, dto);
  }

  @Delete('codes/:id')
  deleteCode(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.deleteCode(id);
  }

  @Get('permanence-rates')
  findPermanenceRates() {
    return this.service.findPermanenceRates();
  }

  @Patch('permanence-rates/:dayType')
  updatePermanenceRate(@Param('dayType') dayType: string, @Body() dto: UpdatePermanenceRateDto) {
    return this.service.updatePermanenceRate(dayType, dto.Amount);
  }

  @Patch(':key')
  update(@Param('key') key: string, @Body() dto: UpdateTimeSettingDto) {
    return this.service.update(key, dto.Value);
  }
}

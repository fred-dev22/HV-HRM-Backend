import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { RequirePermission } from '../../../common/decorators/require-permission.decorator';
import { DistributionChannelService } from './distribution-channel.service';
import { CreateDistributionChannelDto, UpdateDistributionChannelDto } from './dto/distribution.dto';

// RECRUTEMENT_ACCES ouvre tout le module (decision client du 05/09) : une
// seule permission de classe.
@Controller('recruitment/distribution-channels')
@RequirePermission('RECRUTEMENT_ACCES')
export class DistributionChannelController {
  constructor(private readonly service: DistributionChannelService) {}

  @Get()
  findAll() {
    return this.service.findAll();
  }

  @Post()
  create(@Body() dto: CreateDistributionChannelDto, @CurrentUser('employeeId') employeeId: string) {
    return this.service.create(dto, employeeId);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateDistributionChannelDto,
    @CurrentUser('employeeId') employeeId: string,
  ) {
    return this.service.update(id, dto, employeeId);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser('employeeId') employeeId: string) {
    return this.service.remove(id, employeeId);
  }

  @Post(':id/test')
  test(@Param('id') id: string) {
    return this.service.test(id);
  }
}

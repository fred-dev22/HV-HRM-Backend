import { Module } from '@nestjs/common';
import { OrganizationUnitController } from './organization-unit.controller';
import { OrganizationUnitService } from './organization-unit.service';

@Module({
  controllers: [OrganizationUnitController],
  providers: [OrganizationUnitService],
  exports: [OrganizationUnitService],
})
export class OrganizationUnitModule {}

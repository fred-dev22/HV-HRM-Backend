import { Module } from '@nestjs/common';
import { EmployeeCategoryController } from './employee-category.controller';
import { EmployeeCategoryService } from './employee-category.service';

@Module({
  controllers: [EmployeeCategoryController],
  providers: [EmployeeCategoryService],
  exports: [EmployeeCategoryService],
})
export class EmployeeCategoryModule {}

import { IsNotEmpty, IsUUID } from 'class-validator';

export class AssignCategoryDto {
  @IsUUID()
  @IsNotEmpty()
  EmployeeCategoryId: string;
}

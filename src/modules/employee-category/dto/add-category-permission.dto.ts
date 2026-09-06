import { IsNotEmpty, IsUUID } from 'class-validator';

export class AddCategoryPermissionDto {
  @IsUUID()
  @IsNotEmpty()
  PermissionId: string;
}

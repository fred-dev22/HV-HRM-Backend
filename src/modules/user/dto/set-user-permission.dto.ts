import { IsNotEmpty, IsUUID } from 'class-validator';

export class SetUserPermissionDto {
  @IsUUID()
  @IsNotEmpty()
  PermissionId: string;
}

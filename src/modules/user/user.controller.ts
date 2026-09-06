import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { UserService } from './user.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { AssignCategoryDto } from './dto/assign-category.dto';
import { SetUserPermissionDto } from './dto/set-user-permission.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CurrentPermissions } from '../../common/decorators/current-permissions.decorator';

@Controller('users')
export class UserController {
  constructor(private readonly service: UserService) {}

  @Post()
  @RequirePermission('EMPLOYE_COMPTE_CREER')
  create(@Body() dto: CreateUserDto) {
    return this.service.create(dto);
  }

  @Get()
  @RequirePermission('EMPLOYE_VOIR_TOUT')
  findAll() {
    return this.service.findAll();
  }

  @Get(':id')
  @RequirePermission('EMPLOYE_VOIR_TOUT')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Patch(':id')
  @RequirePermission('EMPLOYE_PERMISSION_GERER')
  update(@Param('id') id: string, @Body() dto: UpdateUserDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @RequirePermission('EMPLOYE_PERMISSION_GERER')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }

  @Post(':id/category')
  @RequirePermission('EMPLOYE_PERMISSION_GERER')
  assignCategory(@Param('id') id: string, @Body() dto: AssignCategoryDto) {
    return this.service.assignCategory(id, dto);
  }

  // Pas de permission dédiée pour lire SES PROPRES permissions effectives —
  // c'est ce qui permet au frontend de savoir quoi afficher juste après le
  // login. Consulter celles d'un AUTRE utilisateur reste protégé.
  @Get(':id/permissions')
  getPermissions(
    @Param('id') id: string,
    @CurrentUser('sub') requesterUserId: string,
    @CurrentPermissions() permissions: Set<string>,
  ) {
    if (id !== requesterUserId && !permissions.has('EMPLOYE_PERMISSION_GERER')) {
      throw new ForbiddenException("Vous n'avez pas la permission de consulter les permissions de cet utilisateur");
    }
    return this.service.getEffectivePermissions(id);
  }

  @Post(':id/permissions')
  @RequirePermission('EMPLOYE_PERMISSION_GERER')
  grantPermission(
    @Param('id') id: string,
    @Body() dto: SetUserPermissionDto,
    @CurrentUser('employeeId') employeeId: string,
  ) {
    return this.service.grantPermission(id, dto, employeeId);
  }

  @Delete(':id/permissions/:permissionId')
  @RequirePermission('EMPLOYE_PERMISSION_GERER')
  revokePermission(@Param('id') id: string, @Param('permissionId') permissionId: string) {
    return this.service.revokePermission(id, permissionId);
  }
}

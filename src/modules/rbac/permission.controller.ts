import { Controller, Get } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { isModuleEnabled, moduleOfPermission } from '../../common/modules/modules.config';

// Catalogue fixe, lecture seule — pas de create/update/delete depuis l'UI
// (voir prisma/seed.ts). Ouvert à tout utilisateur authentifié, nécessaire
// pour peupler l'écran Administration > Rôles.
@Controller('permissions')
export class PermissionController {
  constructor(private readonly prisma: PrismaService) {}

  // Les permissions d'un module coupe pour ce client (ENABLED_MODULES) ne sont
  // pas proposees : on ne gere pas des droits sur un module qui n'existe pas.
  @Get()
  async findAll() {
    const all = await this.prisma.permission.findMany({ orderBy: [{ Module: 'asc' }, { Code: 'asc' }] });
    return all.filter((p) => {
      const module = moduleOfPermission(p.Code);
      return module === null || isModuleEnabled(module);
    });
  }
}

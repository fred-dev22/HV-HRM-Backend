import { Controller, Get } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

// Catalogue fixe, lecture seule — pas de create/update/delete depuis l'UI
// (voir prisma/seed.ts). Ouvert à tout utilisateur authentifié, nécessaire
// pour peupler l'écran Administration > Rôles.
@Controller('permissions')
export class PermissionController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  findAll() {
    return this.prisma.permission.findMany({ orderBy: [{ Module: 'asc' }, { Code: 'asc' }] });
  }
}

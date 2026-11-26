import { Body, Controller, Delete, Get, Post, Put, Query, UseGuards } from '@nestjs/common';
import { LocalStorageService } from './local-storage.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { SystemAdminGuard, isSystemAdminUser } from '../../common/guards/system-admin.guard';
import { StorageSettingsService } from './storage-settings.service';
import { SaveStorageSettingsDto } from './storage-settings.dto';

@Controller('storage-settings')
export class StorageSettingsController {
  constructor(
    private readonly settings: StorageSettingsService,
    private readonly prisma: PrismaService,
    private readonly local: LocalStorageService,
  ) {}

  // Ouvert a tout utilisateur connecte : le frontend affiche la bande d'alerte a
  // tout le monde. Deux booleens seulement, aucun detail de configuration.
  @Get('status')
  async status(@CurrentUser('sub') userId: string) {
    const [configured, canConfigure] = await Promise.all([
      this.settings.isConfigured(),
      isSystemAdminUser(this.prisma, userId),
    ]);
    return { configured, canConfigure };
  }

  // Les routes suivantes sont reservees au compte administrateur de lancement.
  @Get()
  @UseGuards(SystemAdminGuard)
  get() {
    return this.settings.getAdminView();
  }

  @Put()
  @UseGuards(SystemAdminGuard)
  save(@Body() dto: SaveStorageSettingsDto, @CurrentUser('employeeId') employeeId: string) {
    return this.settings.save(dto, employeeId);
  }

  @Delete()
  @UseGuards(SystemAdminGuard)
  reset() {
    return this.settings.reset();
  }

  // Explorateur de dossiers du serveur (selecteur de l'ecran Stockage).
  @Get('browse')
  @UseGuards(SystemAdminGuard)
  browse(@Query('path') dir?: string) {
    return this.local.browse(dir);
  }

  @Post('browse/folder')
  @UseGuards(SystemAdminGuard)
  async createFolder(@Body() body: { parent: string; name: string }) {
    return { path: await this.local.createFolder(body?.parent, body?.name) };
  }

  @Post('test')
  @UseGuards(SystemAdminGuard)
  test() {
    return this.settings.test();
  }
}

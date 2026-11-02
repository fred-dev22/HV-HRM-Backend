import { Controller, Get } from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import { CurrentPermissions } from '../../common/decorators/current-permissions.decorator';

@Controller('dashboard')
export class DashboardController {
  constructor(private readonly service: DashboardService) {}

  // Pas de @RequirePermission : chaque bloc de la reponse est filtre par les
  // permissions de l'appelant (voir DashboardService.summary).
  @Get('summary')
  summary(@CurrentPermissions() permissions: Set<string>) {
    return this.service.summary(permissions);
  }
}

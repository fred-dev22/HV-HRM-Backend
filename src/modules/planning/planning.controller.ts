import { Controller, Get, Query } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { CurrentPermissions } from '../../common/decorators/current-permissions.decorator';
import { PlanningRangeDto } from './planning-range.dto';
import { PlanningService } from './planning.service';

// Pas de @RequirePermission : tout employe authentifie a une vue (au minimum
// la vue publique). Ce que la reponse contient depend de la portee resolue
// cote serveur, voir planning-scope.ts.
@Controller('planning')
export class PlanningController {
  constructor(private readonly service: PlanningService) {}

  @Get('global')
  global(
    @Query() dto: PlanningRangeDto,
    @CurrentUser('employeeId') employeeId: string,
    @CurrentPermissions() permissions: Set<string>,
  ) {
    return this.service.getPlanning(dto.From, dto.To, employeeId, permissions);
  }
}

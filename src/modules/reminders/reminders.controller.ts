import { Controller, Get, Post, Query } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { CurrentPermissions } from '../../common/decorators/current-permissions.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { RemindersService } from './reminders.service';
import { RemindersSchedulerService } from './reminders-scheduler.service';
import { RemindersRangeDto } from './dto/reminders-range.dto';

// Module Administration autonome. Pas de @Public, pas de @RequirePermission de
// classe : la route /upcoming accepte EMPLOYE_VOIR_TOUT (vue entreprise) OU
// EMPLOYE_VOIR_EQUIPE (vue equipe), controle fin dans le service (meme schema
// que HiringRequestController).
@Controller('reminders')
export class RemindersController {
  constructor(
    private readonly service: RemindersService,
    private readonly scheduler: RemindersSchedulerService,
  ) {}

  @Get('upcoming')
  upcoming(
    @Query() dto: RemindersRangeDto,
    @CurrentUser('employeeId') employeeId: string,
    @CurrentPermissions() permissions: Set<string>,
  ) {
    return this.service.getUpcoming(dto, employeeId, permissions);
  }

  // Declenchement manuel de la passe de rappels (QA / exploitation). Idempotent
  // via ReminderDispatchLog. Permission au niveau methode : aucune permission
  // de classe a court-circuiter ici.
  @Post('run-now')
  @RequirePermission('EMPLOYE_VOIR_TOUT')
  runNow() {
    return this.scheduler.runOnce();
  }
}

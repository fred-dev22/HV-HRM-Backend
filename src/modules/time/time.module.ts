import { Module } from '@nestjs/common';
import { ApprovalPoolModule } from '../approval-pool/approval-pool.module';
import { CalendarModule } from '../calendar/calendar.module';
import { TimeEntryController } from './entries/time-entry.controller';
import { TimeEntryService } from './entries/time-entry.service';
import { NotificationModule } from '../notification/notification.module';
import { TimeCalculationController } from './calculation/time-calculation.controller';
import { TimeCalculationService } from './calculation/time-calculation.service';
import { MorphoController } from './morpho/morpho.controller';
import { MorphoService } from './morpho/morpho.service';
import { TimeSettingsController } from './settings/time-settings.controller';
import { TimeSettingsService } from './settings/time-settings.service';

// Module Temps de travail (pointage, saisies de temps, heures supplementaires,
// export Sage). Desactivable par client (cle 'time' de brand/client.json).
// PrismaModule est @Global. Enregistre dans app.module.ts.
@Module({
  imports: [CalendarModule, NotificationModule, ApprovalPoolModule],
  controllers: [TimeSettingsController, MorphoController, TimeCalculationController, TimeEntryController],
  providers: [TimeSettingsService, TimeCalculationService, MorphoService, TimeEntryService],
})
export class TimeModule {}

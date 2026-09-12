import { Module } from '@nestjs/common';
import { NotificationModule } from '../notification/notification.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { RemindersController } from './reminders.controller';
import { RemindersService } from './reminders.service';
import { RemindersSchedulerService } from './reminders-scheduler.service';

// Rappels des echeances a venir (module Administration autonome). Aucune
// dependance vers RecruitmentModule : le service lit directement les tables
// via PrismaService (PrismaModule est @Global). Enregistre dans app.module.ts.
@Module({
  imports: [NotificationModule, RealtimeModule],
  controllers: [RemindersController],
  providers: [RemindersService, RemindersSchedulerService],
})
export class RemindersModule {}

import { Module } from '@nestjs/common';
import { RemindersService } from '../reminders/reminders.service';
import { PlanningController } from './planning.controller';
import { PlanningService } from './planning.service';

// Planning global (grille collaborateurs x jours). PrismaModule est @Global.
// RemindersService ne depend que de PrismaService : il est fourni ici pour lire
// les jalons RH sans importer le module de rappels (et son cron).
@Module({
  controllers: [PlanningController],
  providers: [PlanningService, RemindersService],
})
export class PlanningModule {}

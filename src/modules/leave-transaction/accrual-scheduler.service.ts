import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { LeaveTransactionService } from './leave-transaction.service';

// Verifie une fois par jour si c'est le jour du mois choisi par l'entreprise
// (CompanySettings.LeaveAccrualRunDay) pour generer les acquisitions de
// conges, et ne relance pas si deja execute ce mois-ci
// (CompanySettings.LastLeaveAccrualRunAt).
@Injectable()
export class AccrualSchedulerService {
  private readonly logger = new Logger(AccrualSchedulerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly leaveTransactionService: LeaveTransactionService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_1AM)
  async handleDailyCheck() {
    const settings = await this.prisma.companySettings.findFirst();
    if (!settings?.LeaveAccrualRunDay) return;

    const now = new Date();
    if (now.getDate() !== settings.LeaveAccrualRunDay) return;

    const lastRun = settings.LastLeaveAccrualRunAt;
    if (lastRun && lastRun.getFullYear() === now.getFullYear() && lastRun.getMonth() === now.getMonth()) {
      return;
    }

    // CreatedBy est une FK NOT NULL vers Employee — pas d'acteur "systeme"
    // dedie, on utilise le dernier RH ayant modifie les parametres de
    // l'entreprise (c'est lui qui a choisi ce jour de generation).
    const actorId = settings.ModifiedBy ?? (await this.prisma.employee.findFirstOrThrow()).Id;

    this.logger.log('Déclenchement automatique de la génération des acquisitions de congés');
    await this.leaveTransactionService.generateAccruals(actorId);
  }
}

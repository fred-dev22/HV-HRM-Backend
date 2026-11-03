import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { LeaveTransactionService } from './leave-transaction.service';
import { isAccrualDue } from './accrual-due.util';

// Delai avant la verification de demarrage : laisse la base et le reste de
// l'application finir de s'initialiser.
const STARTUP_CHECK_DELAY_MS = 30_000;

// Genere les acquisitions de conges une fois par mois, a partir du jour choisi
// par l'entreprise (CompanySettings.LeaveAccrualRunDay), et ne relance pas si
// deja execute ce mois-ci (CompanySettings.LastLeaveAccrualRunAt).
//
// L'heure exacte n'a pas d'importance : sur IIS le processus Node s'endort
// quand personne ne s'en sert (le 1er novembre 2026 a 1 h, il dormait et rien
// n'a ete genere). La verification tourne donc chaque nuit ET au demarrage (un
// processus endormi se reveille par un demarrage), et l'echeance est un RATTRAPAGE (jour atteint ou depasse, pas "egal a"). La
// generation reste sans doublon : un seul credit par employe, type et periode.
@Injectable()
export class AccrualSchedulerService implements OnApplicationBootstrap {
  private readonly logger = new Logger(AccrualSchedulerService.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly leaveTransactionService: LeaveTransactionService,
  ) {}

  onApplicationBootstrap() {
    const timer = setTimeout(() => {
      this.handleCheck().catch(() => undefined);
    }, STARTUP_CHECK_DELAY_MS);
    timer.unref();
  }

  @Cron(CronExpression.EVERY_DAY_AT_1AM)
  async handleCheck() {
    if (this.running) return;
    this.running = true;
    try {
      const settings = await this.prisma.companySettings.findFirst();
      if (!isAccrualDue(settings?.LeaveAccrualRunDay, settings?.LastLeaveAccrualRunAt, new Date())) return;

      // CreatedBy est une FK NOT NULL vers Employee — pas d'acteur "systeme"
      // dedie, on utilise le dernier RH ayant modifie les parametres de
      // l'entreprise (c'est lui qui a choisi ce jour de generation).
      const actorId = settings!.ModifiedBy ?? (await this.prisma.employee.findFirstOrThrow()).Id;

      this.logger.log('Déclenchement automatique de la génération des acquisitions de congés');
      await this.leaveTransactionService.generateAccruals(actorId);
    } catch (err) {
      this.logger.error(
        'Génération automatique des acquisitions interrompue',
        err instanceof Error ? err.stack : String(err),
      );
    } finally {
      this.running = false;
    }
  }
}

import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../../prisma/prisma.service';
import { DistributionDispatchService } from './distribution-dispatch.service';

// Relance quotidienne des webhooks en echec. LIVRE DESACTIVE : no-op tant que
// process.env.DISTRIBUTION_AUTO_RETRY !== '1'. Quand actif : rejoue une fois
// les lignes Webhook Status=Failed, Attempts<3, LastAttemptAt < 24h, dont le
// canal est encore actif. Ne leve jamais.
@Injectable()
export class DistributionRetrySchedulerService {
  private readonly logger = new Logger(DistributionRetrySchedulerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly dispatch: DistributionDispatchService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_6AM)
  async handleDailyRetry(): Promise<void> {
    if (process.env.DISTRIBUTION_AUTO_RETRY !== '1') return;
    try {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const rows = await this.prisma.jobOfferDistribution.findMany({
        where: {
          ChannelKind: 'Webhook',
          Status: 'Failed',
          Attempts: { lt: 3 },
          LastAttemptAt: { gte: since },
          channel: { IsActive: true, IsDeleted: false },
        },
        select: { Id: true, JobOfferId: true },
      });
      let done = 0;
      for (const r of rows) {
        try {
          await this.dispatch.retryOne(r.JobOfferId, r.Id);
          done += 1;
        } catch (err) {
          this.logger.error(
            `Relance auto de la diffusion ${r.Id} echouee`,
            err instanceof Error ? err.stack : String(err),
          );
        }
      }
      if (rows.length) {
        this.logger.log(`Relance auto des diffusions : ${done}/${rows.length} rejouee(s)`);
      }
    } catch (err) {
      this.logger.error(
        'Relance auto des diffusions interrompue',
        err instanceof Error ? err.stack : String(err),
      );
    }
  }
}

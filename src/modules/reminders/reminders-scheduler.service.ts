import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationService } from '../notification/notification.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { RemindersService } from './reminders.service';
import {
  addDays,
  buildDedupKey,
  leadBucketFor,
  reminderMessage,
  reminderTitle,
  todayDateOnly,
} from './reminders.util';

// Le cron ne regarde que les echeances a 30 jours ou moins (plus grand palier).
const REMINDER_HORIZON_DAYS = 30;
// Purge physique des lignes de journal au-dela de cette anciennete.
const LOG_RETENTION_DAYS = 180;

export interface ReminderRunResult {
  itemsInWindow: number;
  notificationsCreated: number;
  skippedAlreadySent: number;
  purged: number;
}

// Cron quotidien de rappels d'echeances. Reutilise RemindersService.collect()
// (meme code que l'endpoint) puis, pour chaque couple (echeance, palier,
// destinataire), insere une ligne ReminderDispatchLog unique AVANT de creer
// la notification (livraison au plus une fois). Toute la passe est protegee :
// une exception ne doit jamais tuer le scheduler.
@Injectable()
export class RemindersSchedulerService {
  private readonly logger = new Logger(RemindersSchedulerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly reminders: RemindersService,
    private readonly notifications: NotificationService,
    private readonly realtime: RealtimeGateway,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_6AM)
  async handleDaily(): Promise<void> {
    await this.runOnce();
  }

  async runOnce(): Promise<ReminderRunResult> {
    const result: ReminderRunResult = {
      itemsInWindow: 0,
      notificationsCreated: 0,
      skippedAlreadySent: 0,
      purged: 0,
    };

    try {
      const today = todayDateOnly();
      const items = await this.reminders.collect(
        today,
        addDays(today, REMINDER_HORIZON_DAYS),
        { allUnits: true },
      );
      result.itemsInWindow = items.length;

      const rhIds = await this.resolveVoirToutRecipients();
      if (rhIds.length === 0) {
        this.logger.warn(
          "Aucun titulaire actif de EMPLOYE_VOIR_TOUT : seuls les responsables d'unite seront notifies",
        );
      }

      const ouManagerByEmployee = await this.resolveOuManagers(items);

      for (const item of items) {
        const bucket = leadBucketFor(item.daysUntil);
        if (bucket === null) continue;

        const recipientIds = new Set<string>(rhIds);
        if (item.employeeId) {
          const mgr = ouManagerByEmployee.get(item.employeeId);
          if (mgr) recipientIds.add(mgr);
        }
        if (recipientIds.size === 0) continue;

        for (const recipientId of recipientIds) {
          const key = buildDedupKey(
            item.category,
            item.entityType,
            item.entityId,
            item.date,
            bucket,
            recipientId,
          );

          try {
            await this.prisma.reminderDispatchLog.create({
              data: {
                DedupKey: key,
                Category: item.category,
                EntityType: item.entityType,
                EntityId: item.entityId,
                DueDate: new Date(item.date),
                LeadBucket: bucket,
                RecipientEmployeeId: recipientId,
              },
            });
          } catch (err: unknown) {
            if ((err as { code?: string })?.code === 'P2002') {
              result.skippedAlreadySent += 1;
              continue;
            }
            throw err;
          }

          await this.notifications.create({
            employeeId: recipientId,
            type: 'reminder',
            title: reminderTitle(item),
            message: reminderMessage(item),
            href: item.href,
          });
          result.notificationsCreated += 1;
        }
      }

      if (result.notificationsCreated > 0) {
        this.realtime.broadcastCompany('data:changed', { domain: 'reminders' });
      }

      result.purged = await this.purgeOldLogs();
    } catch (err) {
      this.logger.error('Echec de la passe de rappels d echeances', err as Error);
    }

    return result;
  }

  // Titulaires actifs, non supprimes, non systeme de EMPLOYE_VOIR_TOUT.
  private async resolveVoirToutRecipients(): Promise<string[]> {
    const rows = await this.prisma.userPermission.findMany({
      where: {
        permission: { Code: 'EMPLOYE_VOIR_TOUT' },
        user: {
          IsActive: true,
          employee: { IsDeleted: false, Status: 'Active', IsSystem: false },
        },
      },
      select: { user: { select: { employee: { select: { Id: true } } } } },
    });

    const ids = new Set<string>();
    for (const r of rows) {
      const id = r.user?.employee?.Id;
      if (id) ids.add(id);
    }
    return [...ids];
  }

  // employeeId -> Id du responsable de son unite organisationnelle, seulement
  // si ce responsable est actif et non supprime.
  private async resolveOuManagers(
    items: { employeeId?: string }[],
  ): Promise<Map<string, string>> {
    const employeeIds = [
      ...new Set(items.map((i) => i.employeeId).filter((x): x is string => !!x)),
    ];
    if (employeeIds.length === 0) return new Map();

    const employees = await this.prisma.employee.findMany({
      where: { Id: { in: employeeIds } },
      select: { Id: true, organizationUnit: { select: { ManagerId: true } } },
    });

    const managerIds = [
      ...new Set(
        employees
          .map((e) => e.organizationUnit?.ManagerId ?? null)
          .filter((x): x is string => !!x),
      ),
    ];

    const validManagers = new Set<string>(
      managerIds.length === 0
        ? []
        : (
            await this.prisma.employee.findMany({
              where: {
                Id: { in: managerIds },
                IsDeleted: false,
                Status: { not: 'Inactive' },
              },
              select: { Id: true },
            })
          ).map((e) => e.Id),
    );

    const map = new Map<string, string>();
    for (const e of employees) {
      const mgr = e.organizationUnit?.ManagerId ?? null;
      if (mgr && validManagers.has(mgr)) map.set(e.Id, mgr);
    }
    return map;
  }

  private async purgeOldLogs(): Promise<number> {
    const cutoff = new Date(Date.now() - LOG_RETENTION_DAYS * 86_400_000);
    const { count } = await this.prisma.reminderDispatchLog.deleteMany({
      where: { CreatedAt: { lt: cutoff } },
    });
    return count;
  }
}

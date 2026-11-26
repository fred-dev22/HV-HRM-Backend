import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { ApprovalPoolService } from '../../approval-pool/approval-pool.service';
import { NotificationService } from '../../notification/notification.service';
import { MailService } from '../../mail/mail.service';
import { escapeHtml, frontendOrigin, renderEmailHtml } from '../../mail/email-templates';
import { isOnApprovedLeave } from '../../../common/utils/approver-resolution.util';
import { TimeCalculationService } from '../calculation/time-calculation.service';
import { addDays, round2 } from '../calculation/overtime-engine';

const ENTITY_TYPE = 'TimeEntry';
const TITLE = 'Alerte heures supplémentaires';
const LINK = '/hr/time?tab=weeks';

interface Recipient {
  Id: string;
  Email: string | null;
}

const frHours = (h: number) => `${String(round2(h)).replace('.', ',')} h`;
const frMonth = (month: string) =>
  new Date(`${month}-01T00:00:00Z`).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' });

// Previent le manager et la RH quand les heures supplementaires du mois d'un
// employe atteignent le seuil d'alerte : au controle d'une semaine, ou a sa
// validation. Une seule fois par employe et par mois.
@Injectable()
export class OvertimeAlertService {
  private readonly logger = new Logger(OvertimeAlertService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly calculation: TimeCalculationService,
    private readonly approvalPools: ApprovalPoolService,
    private readonly notifications: NotificationService,
    private readonly mail: MailService,
  ) {}

  // Ne fait jamais echouer le controle ou la validation qui la declenche.
  async notifyIfReached(employeeId: string, monday: string, actorId: string): Promise<void> {
    try {
      await this.send(employeeId, monday, actorId);
    } catch (err) {
      this.logger.error(`Alerte heures supplémentaires non envoyée : ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async send(employeeId: string, monday: string, actorId: string) {
    // Comme en paie, une semaine appartient au mois de son dimanche.
    const month = addDays(monday, 6).slice(0, 7);
    const { alertHours, legalHours } = await this.calculation.overtimeThresholds();
    const hours = round2((await this.calculation.monthlyOvertime([employeeId], month)).get(employeeId) ?? 0);
    if (hours <= 0 || hours < alertHours) return;
    const already = await this.prisma.timeOvertimeAlert.findFirst({ where: { EmployeeId: employeeId, Month: month }, select: { Id: true } });
    if (already) return;

    const employee = await this.prisma.employee.findUniqueOrThrow({
      where: { Id: employeeId },
      select: { FullName: true, EmployeeNumber: true },
    });
    const recipients = await this.recipients(employeeId);
    // Reservee avant l'envoi : deux controles simultanes n'alertent qu'une fois
    // (contrainte d'unicite employe + mois).
    await this.prisma.timeOvertimeAlert.create({
      data: { EmployeeId: employeeId, Month: month, Hours: hours, Threshold: alertHours, TriggeredById: actorId },
    });

    const legal = hours >= legalHours ? ' Le seuil légal est atteint.' : '';
    const message = `${employee.FullName} (${employee.EmployeeNumber}) a ${frHours(hours)} supplémentaires en ${frMonth(month)} (seuil d'alerte ${frHours(alertHours)}, seuil légal ${frHours(legalHours)}).${legal}`;
    for (const person of recipients) {
      try {
        await this.notifications.create({ employeeId: person.Id, type: 'system', title: TITLE, message, href: LINK });
      } catch (err) {
        this.logger.warn(`Notification d'alerte non créée : ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    await this.prisma.timeWeekHistory.create({
      data: {
        EmployeeId: employeeId,
        WeekStart: new Date(`${monday}T00:00:00Z`),
        Action: 'ALERT',
        ActorId: actorId,
        Comment: `${frHours(hours)} supplémentaires en ${frMonth(month)} : ${recipients.length} personne(s) prévenue(s) (manager et RH)`,
      },
    });

    // Les emails partent sans retarder l'ecran ; un envoi non configure est seulement journalise.
    const html = renderEmailHtml({
      accent: 'warning',
      headerLabel: 'Temps de travail',
      title: TITLE,
      bodyLines: [escapeHtml(message)],
      ctaLabel: 'Voir les semaines',
      ctaHref: `${frontendOrigin()}${LINK}`,
    });
    void (async () => {
      for (const person of recipients) {
        if (person.Email) await this.mail.send({ to: person.Email, subject: `${TITLE} : ${employee.FullName}`, html });
      }
    })().catch((err) => this.logger.warn(`Email d'alerte non envoyé : ${err instanceof Error ? err.message : String(err)}`));
  }

  // Le manager (validateur direct, sinon pool de validation des temps de son
  // entite, et responsable de l'entite), leurs interimaires quand ils sont en
  // conge, et les personnes qui administrent le temps de travail (RH).
  async recipients(employeeId: string): Promise<Recipient[]> {
    const employee = await this.prisma.employee.findUniqueOrThrow({
      where: { Id: employeeId },
      select: {
        DirectValidatorId: true,
        OrganizationUnitId: true,
        organizationUnit: { select: { ManagerId: true } },
        directValidator: { select: { ValidatorInterimId: true } },
      },
    });
    const ids = new Set<string>();
    const addWithInterim = async (id: string, interimId: string | null | undefined) => {
      ids.add(id);
      if (interimId && (await isOnApprovedLeave(this.prisma, id))) ids.add(interimId);
    };
    if (employee.DirectValidatorId) {
      await addWithInterim(employee.DirectValidatorId, employee.directValidator?.ValidatorInterimId);
    } else {
      const pool = await this.approvalPools.findApplicablePool(employee.OrganizationUnitId, ENTITY_TYPE);
      for (const member of pool?.members ?? []) await addWithInterim(member.EmployeeId, member.InterimEmployeeId);
    }
    if (employee.organizationUnit?.ManagerId) ids.add(employee.organizationUnit.ManagerId);

    const hr = await this.prisma.employee.findMany({
      where: { IsDeleted: false, user: { IsActive: true, userPermissions: { some: { permission: { Code: 'TEMPS_ACCES' } } } } },
      select: { Id: true },
    });
    hr.forEach((e) => ids.add(e.Id));
    ids.delete(employeeId);
    if (ids.size === 0) return [];
    return this.prisma.employee.findMany({ where: { Id: { in: [...ids] }, IsDeleted: false }, select: { Id: true, Email: true } });
  }
}

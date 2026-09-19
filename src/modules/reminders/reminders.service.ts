import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RemindersRangeDto } from './dto/reminders-range.dto';
import {
  addDays,
  assertCanViewDeadlines,
  CATEGORY_ORDER,
  daysBetween,
  daysUntil,
  nextBirthdayOccurrence,
  reminderLabel,
  ReminderItem,
  startOfDayUtc,
  todayDateOnly,
  toYmd,
} from './reminders.util';

const DEFAULT_WINDOW_DAYS = 90;
const MAX_WINDOW_DAYS = 366;

export interface RemindersScope {
  // true = perimetre RH complet (toutes unites + essais + contrats).
  allUnits: boolean;
  // Perimetre equipe : unites organisationnelles directement gerees par
  // l'appelant. Une liste vide donne un resultat vide (pas une erreur).
  managedUnitIds?: string[];
}

const HREF = {
  // Fiche employe en popup depuis l'onglet Employes (lien direct ?open=<id>),
  // plus de page d'edition dediee.
  employee: (id: string): string => `/hr/employees?open=${id}`,
  trial: '/hr/recruitment/trial',
  contract: '/hr/recruitment/contracts',
};

// Module Administration autonome : agrege les echeances datees (fins de CDD,
// de stage, anniversaires, fins de periode d'essai, fins de contrat de
// recrutement) sur une fenetre bornee. Le meme collecteur alimente l'endpoint
// et le cron quotidien de rappels.
@Injectable()
export class RemindersService {
  constructor(private readonly prisma: PrismaService) {}

  // Point d'entree de l'endpoint : resout la fenetre + le perimetre a partir
  // des permissions effectives, puis delegue a collect().
  async getUpcoming(
    dto: RemindersRangeDto,
    employeeId: string,
    permissions: Set<string>,
  ): Promise<ReminderItem[]> {
    assertCanViewDeadlines(permissions);

    const today = todayDateOnly();
    const from = dto.From ? startOfDayUtc(dto.From) : today;
    const to = dto.To ? startOfDayUtc(dto.To) : addDays(today, DEFAULT_WINDOW_DAYS);

    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      throw new BadRequestException('Dates de periode invalides');
    }
    if (from.getTime() > to.getTime()) {
      throw new BadRequestException('La date de debut doit preceder la date de fin');
    }
    if (daysBetween(from, to) > MAX_WINDOW_DAYS) {
      throw new BadRequestException('La periode ne peut pas depasser 366 jours');
    }

    if (permissions.has('EMPLOYE_VOIR_TOUT')) {
      return this.collect(from, to, { allUnits: true });
    }

    // EMPLOYE_VOIR_EQUIPE uniquement : unites directement gerees (pas de
    // recursion sur ParentId, decision 05/09).
    const managedUnitIds = (
      await this.prisma.organizationUnit.findMany({
        where: { ManagerId: employeeId, IsDeleted: false },
        select: { Id: true },
      })
    ).map((u) => u.Id);

    return this.collect(from, to, { allUnits: false, managedUnitIds });
  }

  // Agregateur partage. `from`/`to` sont des dates a minuit UTC, bornes
  // incluses. daysUntil est calcule par rapport a aujourd'hui (date serveur),
  // jamais par rapport a `from`.
  async collect(from: Date, to: Date, scope: RemindersScope): Promise<ReminderItem[]> {
    const today = todayDateOnly();
    const winStart = startOfDayUtc(from);
    const winEnd = startOfDayUtc(to);

    const teamScoped = !scope.allUnits;
    const unitIds = scope.managedUnitIds ?? [];
    if (teamScoped && unitIds.length === 0) return [];

    const unitWhere = teamScoped ? { OrganizationUnitId: { in: unitIds } } : {};
    const items: ReminderItem[] = [];

    // 1) Fin de CDD : Employee FixedTerm avec TerminationDate dans la fenetre.
    const cdd = await this.prisma.employee.findMany({
      where: {
        IsDeleted: false,
        Status: { not: 'Inactive' },
        ContractType: 'FixedTerm',
        TerminationDate: { gte: winStart, lte: winEnd },
        ...unitWhere,
      },
      select: {
        Id: true,
        FullName: true,
        TerminationDate: true,
        organizationUnit: { select: { Name: true } },
      },
    });
    for (const e of cdd) {
      if (!e.TerminationDate) continue;
      items.push({
        category: 'cdd_end',
        entityType: 'Employee',
        entityId: e.Id,
        date: toYmd(e.TerminationDate),
        daysUntil: daysUntil(e.TerminationDate, today),
        label: reminderLabel('cdd_end', e.FullName),
        subjectName: e.FullName,
        employeeId: e.Id,
        entityName: e.organizationUnit?.Name,
        href: HREF.employee(e.Id),
      });
    }

    // 2) Fin de stage : Employee Internship avec TerminationDate dans la fenetre.
    const interns = await this.prisma.employee.findMany({
      where: {
        IsDeleted: false,
        Status: { not: 'Inactive' },
        ContractType: 'Internship',
        TerminationDate: { gte: winStart, lte: winEnd },
        ...unitWhere,
      },
      select: {
        Id: true,
        FullName: true,
        TerminationDate: true,
        organizationUnit: { select: { Name: true } },
      },
    });
    for (const e of interns) {
      if (!e.TerminationDate) continue;
      items.push({
        category: 'internship_end',
        entityType: 'Employee',
        entityId: e.Id,
        date: toYmd(e.TerminationDate),
        daysUntil: daysUntil(e.TerminationDate, today),
        label: reminderLabel('internship_end', e.FullName),
        subjectName: e.FullName,
        employeeId: e.Id,
        entityName: e.organizationUnit?.Name,
        href: HREF.employee(e.Id),
      });
    }

    // 3) Anniversaires : filtre en memoire sur mois/jour, passage d'annee gere.
    const people = await this.prisma.employee.findMany({
      where: {
        IsDeleted: false,
        Status: { not: 'Inactive' },
        ...unitWhere,
      },
      select: {
        Id: true,
        FullName: true,
        BirthDate: true,
        organizationUnit: { select: { Name: true } },
      },
    });
    for (const e of people) {
      if (!e.BirthDate) continue;
      const occ = nextBirthdayOccurrence(e.BirthDate, winStart);
      if (occ.getTime() < winStart.getTime() || occ.getTime() > winEnd.getTime()) continue;
      items.push({
        category: 'birthday',
        entityType: 'Employee',
        entityId: e.Id,
        date: toYmd(occ),
        daysUntil: daysUntil(occ, today),
        label: reminderLabel('birthday', e.FullName),
        subjectName: e.FullName,
        employeeId: e.Id,
        entityName: e.organizationUnit?.Name,
        href: HREF.employee(e.Id),
      });
    }

    // 4) + 5) : perimetre RH complet uniquement (ces entites n'ont pas de lien
    // vers une unite organisationnelle, leur EntityName est du texte libre).
    if (scope.allUnits) {
      const trials = await this.prisma.trialEmployee.findMany({
        where: {
          IsDeleted: false,
          Status: { in: ['OnTrial', 'Extended'] },
          TrialEndDate: { gte: winStart, lte: winEnd },
        },
        select: { Id: true, EmployeeName: true, EntityName: true, TrialEndDate: true },
      });
      for (const t of trials) {
        items.push({
          category: 'trial_end',
          entityType: 'TrialEmployee',
          entityId: t.Id,
          date: toYmd(t.TrialEndDate),
          daysUntil: daysUntil(t.TrialEndDate, today),
          label: reminderLabel('trial_end', t.EmployeeName),
          subjectName: t.EmployeeName,
          entityName: t.EntityName,
          href: HREF.trial,
        });
      }

      const contracts = await this.prisma.recruitmentContract.findMany({
        where: {
          IsDeleted: false,
          Status: 'Accepted',
          EndDate: { not: null, gte: winStart, lte: winEnd },
        },
        select: { Id: true, CandidateName: true, EntityName: true, EndDate: true },
      });
      for (const c of contracts) {
        if (!c.EndDate) continue;
        items.push({
          category: 'contract_end',
          entityType: 'RecruitmentContract',
          entityId: c.Id,
          date: toYmd(c.EndDate),
          daysUntil: daysUntil(c.EndDate, today),
          label: reminderLabel('contract_end', c.CandidateName),
          subjectName: c.CandidateName,
          entityName: c.EntityName,
          href: HREF.contract,
        });
      }
    }

    items.sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      return CATEGORY_ORDER[a.category] - CATEGORY_ORDER[b.category];
    });
    return items;
  }
}

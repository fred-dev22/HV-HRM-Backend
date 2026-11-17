import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { isModuleEnabled } from '../../common/modules/modules.config';
import { RemindersService } from '../reminders/reminders.service';
import { toYmd } from '../reminders/reminders.util';
import {
  APPROVED_LIKE,
  MAX_EMPLOYEES,
  MAX_WINDOW_DAYS,
  PENDING_LIKE,
  PlanningScope,
  resolvePlanningScope,
} from './planning-scope';

export interface PlanningEmployee {
  id: string;
  name: string;
  unit: string | null;
  position: string | null;
}

export interface PlanningLeave {
  employeeId: string;
  start: string;
  end: string;
  startPeriod: string;
  endPeriod: string;
  // Absents de la vue publique : ni motif ni couleur.
  typeName?: string;
  color?: string;
  pending?: boolean;
}

export interface PlanningTimeEntry {
  employeeId: string;
  date: string;
  entryType: string | null;
  hours: number;
}

export interface PlanningMilestone {
  employeeId: string;
  date: string;
  category: string;
  label: string;
}

export interface PlanningResult {
  scope: PlanningScope;
  from: string;
  to: string;
  employees: PlanningEmployee[];
  truncated: boolean;
  leaves: PlanningLeave[];
  timeEntries: PlanningTimeEntry[];
  milestones: PlanningMilestone[];
}

const DAY_MS = 86_400_000;

// Planning global (grille collaborateurs x jours). Une seule route, dont le
// contenu est decide cote serveur par la portee de l'appelant : le client ne
// peut pas demander plus que ce que ses permissions autorisent.
@Injectable()
export class PlanningService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reminders: RemindersService,
  ) {}

  async getPlanning(
    from: string,
    to: string,
    employeeId: string,
    permissions: Set<string>,
  ): Promise<PlanningResult> {
    const start = new Date(from.slice(0, 10));
    const end = new Date(to.slice(0, 10));
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) {
      throw new BadRequestException('Periode invalide.');
    }
    if ((end.getTime() - start.getTime()) / DAY_MS > MAX_WINDOW_DAYS) {
      throw new BadRequestException(`La periode ne peut pas depasser ${MAX_WINDOW_DAYS} jours.`);
    }

    const scope = resolvePlanningScope(permissions);
    const { employees, truncated } = await this.loadEmployees(scope, employeeId);
    const ids = employees.map((e) => e.id);
    const detailed = scope !== 'public';

    const [leaves, timeEntries, milestones] = await Promise.all([
      this.loadLeaves(ids, start, end, detailed),
      detailed ? this.loadTimeEntries(ids, start, end) : Promise.resolve([]),
      scope === 'all' && permissions.has('EMPLOYE_VOIR_TOUT')
        ? this.loadMilestones(ids, start, end)
        : Promise.resolve([]),
    ]);

    return {
      scope,
      from: toYmd(start),
      to: toYmd(end),
      employees,
      truncated,
      leaves,
      timeEntries,
      milestones,
    };
  }

  private async loadEmployees(
    scope: PlanningScope,
    employeeId: string,
  ): Promise<{ employees: PlanningEmployee[]; truncated: boolean }> {
    const where: Record<string, unknown> = {
      IsDeleted: false,
      // Le compte d'amorcage n'est pas une personne.
      IsSystem: false,
      Status: { not: 'Inactive' },
    };
    if (scope === 'team') {
      const unitIds = await this.collectManagedUnitIds(employeeId);
      // L'appelant fait partie de son propre planning d'equipe.
      where.OR = [{ OrganizationUnitId: { in: unitIds } }, { Id: employeeId }];
    }
    const rows = await this.prisma.employee.findMany({
      where,
      select: {
        Id: true,
        FullName: true,
        organizationUnit: { select: { Name: true } },
        position: { select: { Title: true } },
      },
      orderBy: [{ FullName: 'asc' }, { Id: 'asc' }],
      take: MAX_EMPLOYEES + 1,
    });
    const truncated = rows.length > MAX_EMPLOYEES;
    return {
      truncated,
      employees: rows.slice(0, MAX_EMPLOYEES).map((r) => ({
        id: r.Id,
        name: r.FullName,
        unit: r.organizationUnit?.Name ?? null,
        position: scope === 'public' ? null : (r.position?.Title ?? null),
      })),
    };
  }

  // Unites dont l'appelant est responsable, ou ou il valide un circuit de
  // conges, avec leurs sous-unites (meme regle que la liste "mon equipe" des
  // demandes de conge).
  private async collectManagedUnitIds(managerEmployeeId: string): Promise<string[]> {
    const [managedRoots, validatorPools] = await Promise.all([
      this.prisma.organizationUnit.findMany({
        where: { ManagerId: managerEmployeeId },
        select: { Id: true },
      }),
      this.prisma.approvalPool.findMany({
        where: { ObjectType: 'Leave', members: { some: { EmployeeId: managerEmployeeId } } },
        select: { OrganizationUnitId: true },
      }),
    ]);
    const seen = new Set<string>();
    const queue = [
      ...managedRoots.map((u) => u.Id),
      ...validatorPools.map((p) => p.OrganizationUnitId).filter((id): id is string => !!id),
    ];
    while (queue.length > 0) {
      const id = queue.shift() as string;
      if (seen.has(id)) continue;
      seen.add(id);
      const children = await this.prisma.organizationUnit.findMany({
        where: { ParentId: id },
        select: { Id: true },
      });
      queue.push(...children.map((c) => c.Id));
    }
    return [...seen];
  }

  private async loadLeaves(
    ids: string[],
    start: Date,
    end: Date,
    detailed: boolean,
  ): Promise<PlanningLeave[]> {
    if (ids.length === 0) return [];
    const rows = await this.prisma.leaveRequest.findMany({
      where: {
        IsDeleted: false,
        EmployeeId: { in: ids },
        Status: { in: detailed ? [...APPROVED_LIKE, ...PENDING_LIKE] : APPROVED_LIKE },
        StartDate: { lte: end },
        EndDate: { gte: start },
      },
      select: {
        EmployeeId: true,
        StartDate: true,
        EndDate: true,
        StartPeriod: true,
        EndPeriod: true,
        Status: true,
        leaveType: { select: { Name: true, Color: true } },
      },
    });
    return rows.map((r) => ({
      employeeId: r.EmployeeId,
      start: toYmd(r.StartDate),
      end: toYmd(r.EndDate),
      startPeriod: r.StartPeriod,
      endPeriod: r.EndPeriod,
      ...(detailed
        ? {
            typeName: r.leaveType.Name,
            color: r.leaveType.Color,
            pending: PENDING_LIKE.includes(r.Status),
          }
        : {}),
    }));
  }

  // Module Temps : saisies manuelles approuvees (mission, travail hors site,
  // permanence...). Absent si le module est coupe pour ce client.
  private async loadTimeEntries(ids: string[], start: Date, end: Date): Promise<PlanningTimeEntry[]> {
    if (ids.length === 0 || !isModuleEnabled('time')) return [];
    const rows = await this.prisma.timeManualEntry.findMany({
      where: { EmployeeId: { in: ids }, Status: 'Approved', Date: { gte: start, lte: end } },
      select: { EmployeeId: true, Date: true, EntryType: true, Hours: true },
    });
    return rows.map((r) => ({
      employeeId: r.EmployeeId,
      date: toYmd(r.Date),
      entryType: r.EntryType,
      hours: Number(r.Hours),
    }));
  }

  // Jalons RH (fins de CDD, de stage, de periode d'essai, de contrat) :
  // reserves a la vue "all". Les anniversaires n'en sont pas.
  private async loadMilestones(ids: string[], start: Date, end: Date): Promise<PlanningMilestone[]> {
    if (!isModuleEnabled('deadlines')) return [];
    const known = new Set(ids);
    const items = await this.reminders.collect(start, end, { allUnits: true });
    return items
      .filter((i) => i.category !== 'birthday' && i.employeeId && known.has(i.employeeId))
      .map((i) => ({
        employeeId: i.employeeId as string,
        date: i.date,
        category: i.category,
        label: i.label,
      }));
  }
}

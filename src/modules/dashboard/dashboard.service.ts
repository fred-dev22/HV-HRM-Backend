import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { isModuleEnabled } from '../../common/modules/modules.config';

const PENDING_STATUSES = ['Pending', 'InApprovalN1', 'InApprovalN2', 'InApprovalN3', 'InApprovalN4'];
const APPROVED_LIKE = ['Approved', 'Registered', 'Done', 'Regularized'];

// Chiffres du tableau de bord RH : tous calcules en base par des COUNT, sur
// l'ensemble des donnees (jamais sur une liste partiellement chargee), sans
// aucun compteur stocke qui pourrait deriver. Chaque bloc n'est renvoye que
// si l'appelant a la permission de voir les donnees correspondantes.
@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async summary(permissions: Set<string>) {
    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const nextMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

    const employees = permissions.has('EMPLOYE_VOIR_TOUT')
      ? await this.employeeCounts(monthStart, nextMonthStart)
      : null;
    const leaves = permissions.has('CONGE_VOIR_TOUT')
      ? await this.leaveCounts(monthStart, nextMonthStart, today)
      : null;
    // Bloc Temps de travail : seulement si le module est actif chez ce client et
    // que l'appelant a l'acces complet au module.
    const time = isModuleEnabled('time') && permissions.has('TEMPS_ACCES')
      ? await this.timeCounts(monthStart, nextMonthStart, today)
      : null;
    return { employees, leaves, time };
  }

  // Chiffres du pointage, tous calcules en base (COUNT / SUM) sur l'ensemble des donnees.
  private async timeCounts(monthStart: Date, nextMonthStart: Date, today: Date) {
    const [pendingEntries, clockedToday, unmatched, hours, overtime, lastImport] = await Promise.all([
      this.prisma.timeManualEntry.count({ where: { Status: 'Pending' } }),
      this.prisma.timeMorphoRecord.groupBy({ by: ['EmployeeId'], where: { DateJour: today, EmployeeId: { not: null } } }),
      this.prisma.timeMorphoRecord.groupBy({ by: ['BiometricUuid'], where: { EmployeeId: null } }),
      this.prisma.timeDailyHours.aggregate({
        where: { Date: { gte: monthStart, lt: nextMonthStart } },
        _sum: { WorkedHours: true, RequiredHours: true },
      }),
      this.prisma.timeOvertime.aggregate({ where: { Date: { gte: monthStart, lt: nextMonthStart } }, _sum: { Hours: true } }),
      this.prisma.timeMorphoImport.findFirst({ orderBy: { ImportDate: 'desc' }, select: { ImportDate: true, Status: true } }),
    ]);
    return {
      pendingEntries,
      clockedToday: clockedToday.length,
      unmatchedPeople: unmatched.length,
      workedHoursMonth: Number(hours._sum.WorkedHours ?? 0),
      requiredHoursMonth: Number(hours._sum.RequiredHours ?? 0),
      overtimeHoursMonth: Number(overtime._sum.Hours ?? 0),
      lastImportAt: lastImport?.ImportDate ?? null,
      lastImportStatus: lastImport?.Status ?? null,
    };
  }

  private async employeeCounts(monthStart: Date, nextMonthStart: Date) {
    const base = { IsSystem: false, IsDeleted: false };
    const [total, active, newThisMonth] = await Promise.all([
      this.prisma.employee.count({ where: base }),
      this.prisma.employee.count({ where: { ...base, Status: 'Active' } }),
      this.prisma.employee.count({
        where: { ...base, HireDate: { gte: monthStart, lt: nextMonthStart } },
      }),
    ]);
    return { total, active, newThisMonth };
  }

  private async leaveCounts(monthStart: Date, nextMonthStart: Date, today: Date) {
    const base = { IsDeleted: false };
    const [pending, approvedThisMonth, absentToday, approvedTotal] = await Promise.all([
      this.prisma.leaveRequest.count({ where: { ...base, Status: { in: PENDING_STATUSES } } }),
      this.prisma.leaveRequest.count({
        where: {
          ...base,
          Status: { in: APPROVED_LIKE },
          OR: [
            { ModifiedAt: { gte: monthStart, lt: nextMonthStart } },
            { ModifiedAt: null, CreatedAt: { gte: monthStart, lt: nextMonthStart } },
          ],
        },
      }),
      this.prisma.leaveRequest.count({
        where: {
          ...base,
          Status: { in: APPROVED_LIKE },
          StartDate: { lte: today },
          EndDate: { gte: today },
        },
      }),
      this.prisma.leaveRequest.count({ where: { ...base, Status: 'Approved' } }),
    ]);
    return { pending, approvedThisMonth, absentToday, approvedTotal };
  }
}

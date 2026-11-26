// Une semaine validee par le RH ne se modifie plus ; une semaine controlee perd
// son controle des que ses donnees changent. Partage par les saisies et l'ecran
// de validation hebdomadaire. Dates en cles 'YYYY-MM-DD'.
import { BadRequestException } from '@nestjs/common';
import type { PrismaService } from '../../../prisma/prisma.service';
import { addDays, mondayOf } from '../calculation/overtime-engine';

const toDate = (key: string) => new Date(`${key}T00:00:00Z`);
export const frShort = (key: string) => key.split('-').reverse().join('/');

export const weekKey = (employeeId: string, dateKey: string) => `${employeeId.toLowerCase()}|${mondayOf(dateKey)}`;

// Semaines validees des employes entre deux dates, en cles weekKey.
export async function validatedWeeks(prisma: PrismaService, employeeIds: string[], from: string, to: string): Promise<Set<string>> {
  const rows = await prisma.timeWeekValidation.findMany({
    where: { EmployeeId: { in: employeeIds }, Status: 'Validated', WeekStart: { gte: toDate(mondayOf(from)), lte: toDate(to) } },
    select: { EmployeeId: true, WeekStart: true },
  });
  return new Set(rows.map((r) => weekKey(r.EmployeeId, r.WeekStart.toISOString().slice(0, 10))));
}

export async function assertWeekOpen(prisma: PrismaService, employeeId: string, dateKey: string) {
  const monday = mondayOf(dateKey);
  const locked = await prisma.timeWeekValidation.findFirst({
    where: { EmployeeId: employeeId, WeekStart: toDate(monday), Status: 'Validated' },
    select: { Id: true },
  });
  if (locked) {
    throw new BadRequestException(
      `La semaine du ${frShort(monday)} au ${frShort(addDays(monday, 6))} est validée : elle ne se modifie plus`,
    );
  }
}

// Retire le controle d'une semaine dont les donnees viennent de changer.
export async function removeControl(prisma: PrismaService, employeeId: string, dateKey: string, actorId: string, reason: string) {
  const monday = toDate(mondayOf(dateKey));
  const removed = await prisma.timeWeekValidation.deleteMany({
    where: { EmployeeId: employeeId, WeekStart: monday, Status: 'Controlled' },
  });
  if (removed.count > 0) {
    await prisma.timeWeekHistory.create({
      data: { EmployeeId: employeeId, WeekStart: monday, Action: 'UNCONTROL', ActorId: actorId, Comment: reason },
    });
  }
}

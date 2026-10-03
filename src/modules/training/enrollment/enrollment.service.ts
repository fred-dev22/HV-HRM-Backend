import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  COLD_EVALUATION_DELAY_MONTHS,
  SEAT_HOLDING_STATUSES,
  addMonthsUtc,
  toDay,
  toNumber,
  todayUtc,
} from '../training.constants';
import { CreateEnrollmentDto, SubmitEvaluationDto } from '../dto/training.dto';

const INCLUDE = {
  session: { select: { Id: true, ScheduledAt: true, course: { select: { Title: true } } } },
  employee: { select: { Id: true, FullName: true, organizationUnit: { select: { Name: true } } } },
  requestedBy: { select: { Id: true, FullName: true } },
} as const;

type EnrollmentRow = {
  Id: string;
  SessionId: string;
  EmployeeId: string;
  RequestedAt: Date;
  Status: string;
  AttendanceSheetSigned: boolean;
  HotScore: unknown;
  HotComment: string | null;
  HotDate: Date | null;
  ColdDueAt: Date | null;
  ColdScore: unknown;
  ColdComment: string | null;
  ColdDate: Date | null;
  session?: { ScheduledAt: Date; course: { Title: string } };
  employee?: { FullName: string; organizationUnit: { Name: string } | null };
  requestedBy?: { FullName: string };
};

export function shapeEnrollment(row: EnrollmentRow) {
  return {
    id: row.Id,
    sessionId: row.SessionId,
    courseTitle: row.session?.course.Title ?? '',
    sessionScheduledAt: row.session?.ScheduledAt.toISOString() ?? '',
    employeeId: row.EmployeeId,
    employeeName: row.employee?.FullName ?? '',
    entityName: row.employee?.organizationUnit?.Name ?? '',
    requestedByName: row.requestedBy?.FullName ?? '',
    requestedAt: toDay(row.RequestedAt) as string,
    status: row.Status,
    attendanceSheetSigned: row.AttendanceSheetSigned || undefined,
    hotEvaluation:
      row.HotScore !== null && row.HotDate
        ? { score: toNumber(row.HotScore) as number, comment: row.HotComment ?? '', date: toDay(row.HotDate) as string }
        : undefined,
    coldEvaluationDueAt: toDay(row.ColdDueAt),
    coldEvaluation:
      row.ColdScore !== null && row.ColdDate
        ? { score: toNumber(row.ColdScore) as number, comment: row.ColdComment ?? '', date: toDay(row.ColdDate) as string }
        : undefined,
  };
}

@Injectable()
export class EnrollmentService {
  constructor(private readonly prisma: PrismaService) {}

  private async findRaw(id: string) {
    const row = await this.prisma.trainingEnrollment.findUnique({ where: { Id: id } });
    if (!row) {
      throw new NotFoundException(`Inscription ${id} introuvable`);
    }
    return row;
  }

  private async findShaped(id: string) {
    const row = await this.prisma.trainingEnrollment.findUniqueOrThrow({ where: { Id: id }, include: INCLUDE });
    return shapeEnrollment(row);
  }

  async findAll() {
    const rows = await this.prisma.trainingEnrollment.findMany({
      include: INCLUDE,
      orderBy: { RequestedAt: 'desc' },
    });
    return rows.map(shapeEnrollment);
  }

  // Une inscription occupe une place tant qu'elle n'est ni refusee ni
  // annulee. Les controles et la creation partagent une transaction pour que
  // deux demandes simultanees ne depassent pas la capacite.
  async create(dto: CreateEnrollmentDto, requesterId: string) {
    const id = await this.prisma.$transaction(async (tx) => {
      const session = await tx.trainingSession.findUnique({
        where: { Id: dto.sessionId },
        include: { enrollments: { select: { Status: true, EmployeeId: true } } },
      });
      if (!session || session.IsDeleted) {
        throw new NotFoundException(`Session ${dto.sessionId} introuvable`);
      }
      if (session.Status !== 'Scheduled') {
        throw new BadRequestException("Cette session n'est plus planifiée");
      }

      const employee = await tx.employee.findUnique({
        where: { Id: dto.employeeId },
        select: { Id: true, IsDeleted: true, Status: true },
      });
      if (!employee || employee.IsDeleted) {
        throw new NotFoundException(`Employé ${dto.employeeId} introuvable`);
      }
      if (employee.Status === 'Inactive') {
        throw new BadRequestException("Cet employé est inactif : il ne peut pas être inscrit");
      }

      const seatHolders = session.enrollments.filter((e) => SEAT_HOLDING_STATUSES.includes(e.Status));
      if (seatHolders.length >= session.Capacity) {
        throw new ConflictException('Cette session est complète');
      }
      if (seatHolders.some((e) => e.EmployeeId === dto.employeeId)) {
        throw new ConflictException('Cet employé est déjà inscrit à cette session');
      }

      const created = await tx.trainingEnrollment.create({
        data: {
          SessionId: dto.sessionId,
          EmployeeId: dto.employeeId,
          RequestedByEmployeeId: requesterId,
          Status: 'Requested',
          CreatedBy: requesterId,
        },
      });
      return created.Id;
    });
    return this.findShaped(id);
  }

  // Ne change le statut que depuis un statut de depart autorise : approuver
  // une demande deja refusee, ou refuser une demande deja approuvee, est une
  // erreur explicite plutot qu'un ecrasement silencieux de la decision.
  private async transition(id: string, from: string[], to: string, employeeId: string, verb: string) {
    const row = await this.findRaw(id);
    if (!from.includes(row.Status)) {
      throw new BadRequestException(`Impossible ${verb} une inscription au statut "${row.Status}"`);
    }
    await this.prisma.trainingEnrollment.update({
      where: { Id: id },
      data: {
        Status: to,
        ...(to === 'Attended' && { AttendanceSheetSigned: true }),
        ModifiedBy: employeeId,
        ModifiedAt: new Date(),
      },
    });
    return this.findShaped(id);
  }

  approve(id: string, employeeId: string) {
    return this.transition(id, ['Requested'], 'Approved', employeeId, "d'approuver");
  }

  reject(id: string, employeeId: string) {
    return this.transition(id, ['Requested'], 'Rejected', employeeId, 'de refuser');
  }

  cancel(id: string, employeeId: string) {
    return this.transition(id, ['Requested', 'Approved'], 'Cancelled', employeeId, "d'annuler");
  }

  attend(id: string, employeeId: string) {
    return this.transition(id, ['Approved'], 'Attended', employeeId, 'de marquer présente');
  }

  private evaluationDay(date?: string): Date {
    if (!date) return todayUtc();
    const parsed = new Date(`${date}T00:00:00.000Z`);
    if (Number.isNaN(parsed.getTime())) {
      throw new BadRequestException('Date invalide');
    }
    return parsed;
  }

  // Evaluation a chaud : seulement une fois la presence enregistree, une
  // seule fois. Elle programme l'evaluation a froid 3 mois plus tard.
  async submitHotEvaluation(id: string, dto: SubmitEvaluationDto, employeeId: string) {
    const row = await this.findRaw(id);
    if (row.Status !== 'Attended') {
      throw new BadRequestException("L'évaluation à chaud n'est possible qu'après la présence à la formation");
    }
    if (row.HotScore !== null) {
      throw new ConflictException("Cette inscription a déjà une évaluation à chaud");
    }
    const date = this.evaluationDay(dto.date);
    await this.prisma.trainingEnrollment.update({
      where: { Id: id },
      data: {
        HotScore: dto.score,
        HotComment: dto.comment.trim(),
        HotDate: date,
        ColdDueAt: addMonthsUtc(date, COLD_EVALUATION_DELAY_MONTHS),
        ModifiedBy: employeeId,
        ModifiedAt: new Date(),
      },
    });
    return this.findShaped(id);
  }

  async submitColdEvaluation(id: string, dto: SubmitEvaluationDto, employeeId: string) {
    const row = await this.findRaw(id);
    if (row.Status !== 'Attended' || row.HotScore === null) {
      throw new BadRequestException("L'évaluation à froid suppose une présence et une évaluation à chaud");
    }
    if (row.ColdScore !== null) {
      throw new ConflictException("Cette inscription a déjà une évaluation à froid");
    }
    await this.prisma.trainingEnrollment.update({
      where: { Id: id },
      data: {
        ColdScore: dto.score,
        ColdComment: dto.comment.trim(),
        ColdDate: this.evaluationDay(dto.date),
        ModifiedBy: employeeId,
        ModifiedAt: new Date(),
      },
    });
    return this.findShaped(id);
  }
}

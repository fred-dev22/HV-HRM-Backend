import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { nextReferenceCode, withReferenceCodeRetry } from '../../recruitment/recruitment.util';
import { SEAT_HOLDING_STATUSES, TRAINING_REFERENCE_PREFIXES } from '../training.constants';
import { CreateSessionDto } from '../dto/training.dto';

const INCLUDE = {
  course: { select: { Id: true, Title: true } },
  enrollments: { select: { Status: true } },
} as const;

type SessionRow = {
  Id: string;
  ReferenceCode: string;
  CourseId: string;
  ScheduledAt: Date;
  EndAt: Date;
  Mode: string;
  Location: string | null;
  MeetingLink: string | null;
  TrainerName: string;
  Status: string;
  Capacity: number;
  course?: { Id: string; Title: string };
  enrollments?: { Status: string }[];
};

export function shapeSession(row: SessionRow) {
  return {
    id: row.Id,
    referenceCode: row.ReferenceCode,
    courseId: row.CourseId,
    courseTitle: row.course?.Title ?? '',
    scheduledAt: row.ScheduledAt.toISOString(),
    endAt: row.EndAt.toISOString(),
    mode: row.Mode,
    location: row.Location ?? undefined,
    meetingLink: row.MeetingLink ?? undefined,
    trainerName: row.TrainerName,
    status: row.Status,
    capacity: row.Capacity,
    enrolledCount: (row.enrollments ?? []).filter((e) => SEAT_HOLDING_STATUSES.includes(e.Status)).length,
  };
}

@Injectable()
export class SessionService {
  constructor(private readonly prisma: PrismaService) {}

  private async findRaw(id: string) {
    const row = await this.prisma.trainingSession.findUnique({ where: { Id: id } });
    if (!row || row.IsDeleted) {
      throw new NotFoundException(`Session ${id} introuvable`);
    }
    return row;
  }

  async findAll() {
    const rows = await this.prisma.trainingSession.findMany({
      where: { IsDeleted: false },
      include: INCLUDE,
      orderBy: { ScheduledAt: 'desc' },
    });
    return rows.map(shapeSession);
  }

  async findOne(id: string) {
    const row = await this.prisma.trainingSession.findUnique({ where: { Id: id }, include: INCLUDE });
    if (!row || row.IsDeleted) {
      throw new NotFoundException(`Session ${id} introuvable`);
    }
    return shapeSession(row);
  }

  async create(dto: CreateSessionDto, employeeId: string) {
    const course = await this.prisma.trainingCourse.findUnique({ where: { Id: dto.courseId } });
    if (!course || course.IsDeleted) {
      throw new NotFoundException(`Formation ${dto.courseId} introuvable`);
    }
    if (course.Status === 'Archived') {
      throw new BadRequestException('Une formation archivée ne peut plus être planifiée');
    }

    const start = new Date(dto.scheduledAt);
    const end = new Date(dto.endAt);
    if (end < start) {
      throw new BadRequestException('La date de fin doit être après le début');
    }
    if (dto.mode === 'InPerson' && !dto.location?.trim()) {
      throw new BadRequestException('Le lieu est requis pour une session en présentiel');
    }
    if (dto.mode === 'VideoCall' && !dto.meetingLink?.trim()) {
      throw new BadRequestException('Le lien de visioconférence est requis');
    }
    if (dto.capacity > course.MaxParticipants) {
      throw new BadRequestException(
        `La capacité (${dto.capacity}) dépasse l'effectif maximum de la formation (${course.MaxParticipants})`,
      );
    }

    const row = await withReferenceCodeRetry(async () =>
      this.prisma.trainingSession.create({
        data: {
          ReferenceCode: await nextReferenceCode(TRAINING_REFERENCE_PREFIXES.session, (p) =>
            this.prisma.trainingSession.findMany({ where: { ReferenceCode: { startsWith: p } }, select: { ReferenceCode: true } }),
          ),
          CourseId: dto.courseId,
          ScheduledAt: start,
          EndAt: end,
          Mode: dto.mode,
          Location: dto.mode === 'InPerson' ? dto.location!.trim() : null,
          MeetingLink: dto.mode === 'VideoCall' ? dto.meetingLink!.trim() : null,
          TrainerName: dto.trainerName.trim(),
          Status: 'Scheduled',
          Capacity: dto.capacity,
          CreatedBy: employeeId,
        },
        include: INCLUDE,
      }),
    );
    return shapeSession(row);
  }

  // Seule une session encore planifiee peut etre terminee ou annulee.
  private async assertScheduled(id: string) {
    const session = await this.findRaw(id);
    if (session.Status !== 'Scheduled') {
      throw new BadRequestException("Cette session n'est plus planifiée");
    }
  }

  async markDone(id: string, employeeId: string) {
    await this.assertScheduled(id);
    const row = await this.prisma.trainingSession.update({
      where: { Id: id },
      data: { Status: 'Done', ModifiedBy: employeeId, ModifiedAt: new Date() },
      include: INCLUDE,
    });
    return shapeSession(row);
  }

  // Annuler une session annule aussi ses inscriptions en cours (demandees ou
  // approuvees) : sinon des demandes "Approuvee" resteraient sur une session
  // qui n'aura jamais lieu. Les presences deja enregistrees ne sont pas touchees.
  async cancel(id: string, employeeId: string) {
    await this.assertScheduled(id);
    const row = await this.prisma.$transaction(async (tx) => {
      await tx.trainingEnrollment.updateMany({
        where: { SessionId: id, Status: { in: ['Requested', 'Approved'] } },
        data: { Status: 'Cancelled', ModifiedBy: employeeId, ModifiedAt: new Date() },
      });
      return tx.trainingSession.update({
        where: { Id: id },
        data: { Status: 'Cancelled', ModifiedBy: employeeId, ModifiedAt: new Date() },
        include: INCLUDE,
      });
    });
    return shapeSession(row);
  }
}

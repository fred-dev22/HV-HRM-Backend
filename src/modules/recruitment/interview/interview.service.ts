import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '../../../../prisma/generated/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { RecruitmentNotifyService } from '../recruitment-notify.service';
import { REFERENCE_PREFIXES } from '../recruitment.constants';
import { nextReferenceCode } from '../recruitment.util';
import { generateApprovalToken } from '../../../common/approval-token';
import { InterviewRsvpService } from './interview-rsvp.service';
import { ManualRsvpDto } from './dto/interview-rsvp.dto';
import {
  ScheduleInterviewDto,
  UpdateInterviewDto,
  EvaluateInterviewDto,
  InterviewParticipantDto,
} from './dto/interview.dto';

// Participant resolu (annuaire complete) + son jeton RSVP opaque.
interface ParticipantWithToken {
  EmployeeId: string | null;
  Name: string;
  Email: string | null;
  rsvpToken: string;
}

const DEFAULT_DURATION_MIN = 60;

const INCLUDE = {
  participants: true,
  evaluation: { include: { criteriaScores: true } },
  application: {
    select: {
      Id: true,
      ReferenceCode: true,
      CandidateName: true,
      CandidateEmail: true,
      JobOfferTitle: true,
      Status: true,
      JobOfferId: true,
    },
  },
} as const;

@Injectable()
export class InterviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notify: RecruitmentNotifyService,
    private readonly rsvp: InterviewRsvpService,
  ) {}

  private async findRaw(id: string) {
    const row = await this.prisma.interview.findUnique({ where: { Id: id }, include: { participants: true } });
    if (!row || row.IsDeleted) {
      throw new NotFoundException(`Entretien ${id} introuvable`);
    }
    return row;
  }

  findAll(applicationId?: string) {
    return this.prisma.interview.findMany({
      where: { IsDeleted: false, ...(applicationId ? { ApplicationId: applicationId } : {}) },
      include: INCLUDE,
      orderBy: { ScheduledAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const row = await this.prisma.interview.findUnique({ where: { Id: id }, include: INCLUDE });
    if (!row || row.IsDeleted) {
      throw new NotFoundException(`Entretien ${id} introuvable`);
    }
    return row;
  }

  private validateModeFields(mode: string, location?: string | null, meetingLink?: string | null) {
    if (mode === 'InPerson' && !location) {
      throw new BadRequestException('Un entretien en presentiel doit indiquer un lieu');
    }
    if (mode === 'VideoCall' && !meetingLink) {
      throw new BadRequestException('Un entretien en visio doit indiquer un lien de reunion');
    }
  }

  // Complete l'email des participants choisis dans l'annuaire (EmployeeId) —
  // l'annuaire cote front ne l'expose pas, on le retrouve ici.
  private async resolveParticipants(list: InterviewParticipantDto[]) {
    const out: { EmployeeId: string | null; Name: string; Email: string | null }[] = [];
    for (const p of list) {
      let email = p.Email ?? null;
      if (!email && p.EmployeeId) {
        const emp = await this.prisma.employee.findUnique({
          where: { Id: p.EmployeeId },
          select: { Email: true },
        });
        email = emp?.Email ?? null;
      }
      out.push({ EmployeeId: p.EmployeeId ?? null, Name: p.Name, Email: email });
    }
    return out;
  }

  private async organizerIdentity(employeeId: string) {
    const me = await this.prisma.employee.findUnique({
      where: { Id: employeeId },
      select: { FullName: true, Email: true },
    });
    return {
      name: me?.FullName ?? 'Recrutement HV',
      email: me?.Email ?? process.env.GRAPH_MAIL_SENDER ?? 'no-reply@localhost',
    };
  }

  async schedule(dto: ScheduleInterviewDto, employeeId: string) {
    const app = await this.prisma.recruitmentApplication.findUnique({ where: { Id: dto.ApplicationId } });
    if (!app || app.IsDeleted) {
      throw new NotFoundException(`Candidature ${dto.ApplicationId} introuvable`);
    }
    this.validateModeFields(dto.Mode, dto.Location, dto.MeetingLink);
    const resolved = await this.resolveParticipants(dto.Participants ?? []);
    // Un jeton RSVP opaque par participant + un pour le candidat (pose sur
    // l'entretien). Generes une seule fois ici (backlog "Suivi des reponses").
    const participants: ParticipantWithToken[] = resolved.map((p) => ({
      ...p,
      rsvpToken: generateApprovalToken(),
    }));
    const candidateRsvpToken = generateApprovalToken();
    const start = new Date(dto.ScheduledAt);
    const duration = dto.DurationMinutes ?? DEFAULT_DURATION_MIN;

    const created = await this.prisma.$transaction(async (tx) => {
      const interview = await tx.interview.create({
        data: {
          ReferenceCode: await nextReferenceCode(REFERENCE_PREFIXES.interview, (p) =>
            tx.interview.count({ where: { ReferenceCode: { startsWith: p } } }),
          ),
          ApplicationId: dto.ApplicationId,
          ScheduledAt: start,
          Mode: dto.Mode,
          Location: dto.Mode === 'InPerson' ? dto.Location : null,
          MeetingLink: dto.Mode === 'VideoCall' ? dto.MeetingLink : null,
          Status: 'Scheduled',
          CandidateRsvpToken: candidateRsvpToken,
          CreatedBy: employeeId,
          participants: {
            create: participants.map((p) => ({
              EmployeeId: p.EmployeeId,
              Name: p.Name,
              Email: p.Email,
              RsvpToken: p.rsvpToken,
            })),
          },
        },
        include: INCLUDE,
      });
      // Effet croise (comme le mock) : la candidature passe en "entretien
      // planifie" si elle etait encore "nouvelle".
      if (app.Status === 'New') {
        await tx.recruitmentApplication.update({
          where: { Id: app.Id },
          data: { Status: 'InterviewScheduled', ModifiedBy: employeeId, ModifiedAt: new Date() },
        });
      }
      return interview;
    });

    const organizer = await this.organizerIdentity(employeeId);
    await this.notify.sendInterviewInvites({
      interviewId: created.Id,
      sequence: 0,
      method: 'REQUEST',
      start,
      durationMinutes: duration,
      candidateName: app.CandidateName,
      candidateEmail: app.CandidateEmail,
      jobOfferTitle: app.JobOfferTitle ?? 'Poste',
      mode: dto.Mode,
      location: dto.Location,
      meetingLink: dto.MeetingLink,
      organizerName: organizer.name,
      organizerEmail: organizer.email,
      candidateRsvpToken,
      participants: participants
        .filter((p) => !!p.Email)
        .map((p) => ({ name: p.Name, email: p.Email as string, rsvpToken: p.rsvpToken })),
    });
    this.notify.broadcast();
    return this.findOne(created.Id);
  }

  async update(id: string, dto: UpdateInterviewDto, employeeId: string) {
    const existing = await this.findRaw(id);
    if (existing.Status !== 'Scheduled') {
      throw new BadRequestException('Seul un entretien planifie peut etre modifie');
    }
    const mode = dto.Mode ?? existing.Mode;
    const location = dto.Location !== undefined ? dto.Location : existing.Location;
    const meetingLink = dto.MeetingLink !== undefined ? dto.MeetingLink : existing.MeetingLink;
    this.validateModeFields(mode, location, meetingLink);
    const start = dto.ScheduledAt ? new Date(dto.ScheduledAt) : existing.ScheduledAt;
    const duration = dto.DurationMinutes ?? DEFAULT_DURATION_MIN;

    // Nouvelle liste de participants -> anciennes lignes (et leurs jetons)
    // supprimees, nouvelles lignes avec un jeton frais. Liste inchangee ->
    // on garde les lignes et leurs jetons, mais on remet Rsvp a "Pending"
    // (le nouveau .ics porte un SEQUENCE incremente + NEEDS-ACTION, la reponse
    // precedente ne s'applique plus). Le jeton candidat est conserve dans les
    // deux cas ; seule sa reponse est remise a zero.
    const newParticipants: ParticipantWithToken[] | null = dto.Participants
      ? (await this.resolveParticipants(dto.Participants)).map((p) => ({
          ...p,
          rsvpToken: generateApprovalToken(),
        }))
      : null;

    await this.prisma.$transaction(async (tx) => {
      if (newParticipants) {
        await tx.interviewParticipant.deleteMany({ where: { InterviewId: id } });
        await tx.interviewParticipant.createMany({
          data: newParticipants.map((p) => ({
            InterviewId: id,
            EmployeeId: p.EmployeeId,
            Name: p.Name,
            Email: p.Email,
            RsvpToken: p.rsvpToken,
          })),
        });
      } else {
        await tx.interviewParticipant.updateMany({
          where: { InterviewId: id },
          data: { Rsvp: 'Pending', RsvpAt: null, RsvpSource: null },
        });
      }
      await tx.interview.update({
        where: { Id: id },
        data: {
          ScheduledAt: start,
          Mode: mode,
          Location: mode === 'InPerson' ? location : null,
          MeetingLink: mode === 'VideoCall' ? meetingLink : null,
          CandidateRsvp: 'Pending',
          CandidateRsvpAt: null,
          CandidateRsvpSource: null,
          ModifiedBy: employeeId,
          ModifiedAt: new Date(),
        },
      });
    });

    const notifyParticipants = newParticipants
      ? newParticipants
          .filter((p) => !!p.Email)
          .map((p) => ({ name: p.Name, email: p.Email as string, rsvpToken: p.rsvpToken }))
      : existing.participants
          .filter((p) => !!p.Email)
          .map((p) => ({ name: p.Name, email: p.Email as string, rsvpToken: p.RsvpToken }));

    const app = await this.prisma.recruitmentApplication.findUniqueOrThrow({ where: { Id: existing.ApplicationId } });
    const organizer = await this.organizerIdentity(employeeId);
    await this.notify.sendInterviewInvites({
      interviewId: id,
      sequence: 1,
      method: 'REQUEST',
      start,
      durationMinutes: duration,
      candidateName: app.CandidateName,
      candidateEmail: app.CandidateEmail,
      jobOfferTitle: app.JobOfferTitle ?? 'Poste',
      mode,
      location,
      meetingLink,
      organizerName: organizer.name,
      organizerEmail: organizer.email,
      candidateRsvpToken: existing.CandidateRsvpToken,
      participants: notifyParticipants,
    });
    this.notify.broadcast();
    return this.findOne(id);
  }

  async cancel(id: string, employeeId: string) {
    const existing = await this.findRaw(id);
    if (existing.Status !== 'Scheduled') {
      throw new BadRequestException('Seul un entretien planifie peut etre annule');
    }
    await this.prisma.interview.update({
      where: { Id: id },
      data: { Status: 'Cancelled', ModifiedBy: employeeId, ModifiedAt: new Date() },
    });
    const app = await this.prisma.recruitmentApplication.findUniqueOrThrow({ where: { Id: existing.ApplicationId } });
    const organizer = await this.organizerIdentity(employeeId);
    await this.notify.sendInterviewInvites({
      interviewId: id,
      sequence: 2,
      method: 'CANCEL',
      start: existing.ScheduledAt,
      durationMinutes: DEFAULT_DURATION_MIN,
      candidateName: app.CandidateName,
      candidateEmail: app.CandidateEmail,
      jobOfferTitle: app.JobOfferTitle ?? 'Poste',
      mode: existing.Mode,
      location: existing.Location,
      meetingLink: existing.MeetingLink,
      organizerName: organizer.name,
      organizerEmail: organizer.email,
      candidateRsvpToken: existing.CandidateRsvpToken,
      participants: existing.participants
        .filter((p) => !!p.Email)
        .map((p) => ({ name: p.Name, email: p.Email as string, rsvpToken: p.RsvpToken })),
    });
    this.notify.broadcast();
    return this.findOne(id);
  }

  // Correction manuelle d'une reponse RSVP par un RH (route authentifiee,
  // deja sous RECRUTEMENT_ACCES). Le detail est porte par InterviewRsvpService,
  // ici on ne fait que renvoyer l'entretien complet apres coup.
  async setRsvp(id: string, dto: ManualRsvpDto, employeeId: string) {
    await this.rsvp.setRsvpManual(id, dto, employeeId);
    return this.findOne(id);
  }

  async markDone(id: string, employeeId: string) {
    const existing = await this.findRaw(id);
    if (existing.Status === 'Cancelled') {
      throw new BadRequestException('Un entretien annule ne peut pas etre marque comme realise');
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.interview.update({
        where: { Id: id },
        data: { Status: 'Done', ModifiedBy: employeeId, ModifiedAt: new Date() },
      });
      await this.advanceApplicationAfterInterview(tx, existing.ApplicationId, employeeId);
    });
    this.notify.broadcast();
    return this.findOne(id);
  }

  // Effet croise symetrique de schedule() (candidature -> "Entretien
  // planifie" des la planification, voir plus haut) : une fois l'entretien
  // realise (marque fait OU evalue, les deux amenent Status: 'Done'), la
  // candidature ne doit plus rester bloquee sur "Entretien planifie" — elle
  // repasse "En cours" pour signaler qu'une decision RH est attendue (aucun
  // circuit automatique au-dela, decision client du 05/09). updateMany avec
  // le filtre de statut en clause WHERE : si le RH a deja avance la
  // candidature entre-temps (Retenue/Refuse/En cours), on ne l'ecrase pas.
  private async advanceApplicationAfterInterview(
    tx: Prisma.TransactionClient,
    applicationId: string,
    employeeId: string,
  ): Promise<void> {
    await tx.recruitmentApplication.updateMany({
      where: { Id: applicationId, Status: 'InterviewScheduled' },
      data: { Status: 'InReview', ModifiedBy: employeeId, ModifiedAt: new Date() },
    });
  }

  async evaluate(id: string, dto: EvaluateInterviewDto, employeeId: string) {
    const existing = await this.findRaw(id);
    if (existing.Status === 'Cancelled') {
      throw new BadRequestException('Un entretien annule ne peut pas etre evalue');
    }

    let templateName: string | undefined;
    if (dto.TemplateId) {
      const tpl = await this.prisma.interviewEvaluationTemplate.findUnique({ where: { Id: dto.TemplateId } });
      if (!tpl || tpl.IsDeleted) {
        throw new NotFoundException(`Grille d'evaluation ${dto.TemplateId} introuvable`);
      }
      templateName = tpl.Name;
    }

    const criteria = dto.CriteriaScores ?? [];
    const score =
      criteria.length > 0
        ? Math.round((criteria.reduce((s, c) => s + c.Score, 0) / criteria.length) * 100) / 100
        : dto.Score;
    if (score === undefined || score === null) {
      throw new BadRequestException('Une note globale ou une grille de criteres est requise');
    }

    const interviewer =
      dto.InterviewerName ??
      (await this.prisma.employee.findUnique({ where: { Id: employeeId }, select: { FullName: true } }))?.FullName ??
      'RH';

    await this.prisma.$transaction(async (tx) => {
      await tx.interviewEvaluation.deleteMany({ where: { InterviewId: id } });
      const evaluation = await tx.interviewEvaluation.create({
        data: {
          InterviewId: id,
          Score: score,
          Comment: dto.Comment,
          InterviewerName: interviewer,
          TemplateName: templateName,
        },
      });
      if (criteria.length > 0) {
        await tx.interviewCriterionScore.createMany({
          data: criteria.map((c) => ({ EvaluationId: evaluation.Id, Label: c.Label, Score: c.Score })),
        });
      }
      await tx.interview.update({
        where: { Id: id },
        data: { Status: 'Done', ModifiedBy: employeeId, ModifiedAt: new Date() },
      });
      await this.advanceApplicationAfterInterview(tx, existing.ApplicationId, employeeId);
    });
    this.notify.broadcast();
    return this.findOne(id);
  }
}

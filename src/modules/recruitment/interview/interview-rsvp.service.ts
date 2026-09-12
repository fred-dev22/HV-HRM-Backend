import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { timingSafeEqual } from 'crypto';
import { Prisma } from '../../../../prisma/generated/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { NotificationService } from '../../notification/notification.service';
import { RecruitmentNotifyService } from '../recruitment-notify.service';
import { ManualRsvpDto } from './dto/interview-rsvp.dto';

// Suivi des reponses aux invitations calendrier (backlog "Suivi des reponses
// aux invitations"). On-prem n'a pas de webhook Graph public : la capture de
// reponse reprend le patron du jeton opaque de la validation par email
// (public-approval). Chaque participant recoit un RsvpToken, le candidat a
// son propre CandidateRsvpToken pose sur l'entretien (jamais une ligne
// participant : update() reconstruit la liste des participants).
//
// GET = strictement en lecture (un scanner anti-phishing pre-visite les liens
// des mails, un GET a effet de bord validerait/annulerait a l'insu du
// destinataire). Seul POST enregistre, via un updateMany atomique cle sur le
// jeton (re-soumettable, la derniere reponse gagne).

// Correspondances minuscule (lien public) <-> libelle stocke.
const LINK_RESPONSE_TO_DB: Record<string, 'Accepted' | 'Declined' | 'Tentative'> = {
  accepted: 'Accepted',
  declined: 'Declined',
  tentative: 'Tentative',
};

// PARTSTAT d'une reponse iMIP (.ics METHOD:REPLY) -> libelle stocke.
const PARTSTAT_TO_DB: Record<string, 'Pending' | 'Accepted' | 'Declined' | 'Tentative'> = {
  'NEEDS-ACTION': 'Pending',
  ACCEPTED: 'Accepted',
  DECLINED: 'Declined',
  TENTATIVE: 'Tentative',
};

const INTERVIEW_UID_RE = /^interview-([0-9a-fA-F-]{36})@productive247$/;

const INTERVIEW_LOAD = {
  participants: true,
  application: {
    select: { CandidateName: true, CandidateEmail: true, JobOfferTitle: true },
  },
} as const;

type LoadedInterview = Prisma.InterviewGetPayload<{ include: typeof INTERVIEW_LOAD }>;

export interface RsvpSummary {
  scope: 'participant' | 'candidate';
  recipientName: string;
  jobOfferTitle: string;
  scheduledAt: string;
  mode: string;
  place: string;
  interviewStatus: 'Scheduled' | 'Done' | 'Cancelled';
  currentResponse: 'Pending' | 'Accepted' | 'Declined' | 'Tentative';
  respondedAt?: string;
}

@Injectable()
export class InterviewRsvpService {
  private readonly logger = new Logger(InterviewRsvpService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notify: RecruitmentNotifyService,
    private readonly notifications: NotificationService,
  ) {}

  private loadInterview(id: string): Promise<LoadedInterview | null> {
    return this.prisma.interview.findFirst({
      where: { Id: id, IsDeleted: false },
      include: INTERVIEW_LOAD,
    });
  }

  private placeOf(itv: { Mode: string; Location: string | null; MeetingLink: string | null }): string {
    if (itv.Mode === 'VideoCall') return itv.MeetingLink ?? 'Visioconference';
    return itv.Location ?? 'Sur site';
  }

  // Resout un jeton : d'abord une ligne participant, sinon le jeton candidat
  // pose sur l'entretien. 404 (message generique) si rien ne correspond ou si
  // l'entretien est supprime.
  private async resolveToken(
    token: string,
  ): Promise<
    | { scope: 'participant'; interview: LoadedInterview; participantId: string }
    | { scope: 'candidate'; interview: LoadedInterview }
  > {
    const notFound = new NotFoundException(
      "Ce lien d'invitation n'existe pas ou n'est plus valide",
    );
    if (!token) throw notFound;

    const participant = await this.prisma.interviewParticipant.findFirst({
      where: { RsvpToken: token },
      select: { Id: true, InterviewId: true },
    });
    if (participant) {
      const interview = await this.loadInterview(participant.InterviewId);
      if (!interview) throw notFound;
      return { scope: 'participant', interview, participantId: participant.Id };
    }

    const byCandidate = await this.prisma.interview.findFirst({
      where: { CandidateRsvpToken: token },
      select: { Id: true },
    });
    if (byCandidate) {
      const interview = await this.loadInterview(byCandidate.Id);
      if (interview) return { scope: 'candidate', interview };
    }

    throw notFound;
  }

  // ── GET public : aucun ecrit ────────────────────────────────────────────
  async getSummary(token: string): Promise<RsvpSummary> {
    const resolved = await this.resolveToken(token);
    const itv = resolved.interview;

    if (resolved.scope === 'participant') {
      const p = itv.participants.find((row) => row.Id === resolved.participantId)!;
      return {
        scope: 'participant',
        recipientName: p.Name,
        jobOfferTitle: itv.application?.JobOfferTitle ?? 'Poste',
        scheduledAt: itv.ScheduledAt.toISOString(),
        mode: itv.Mode,
        place: this.placeOf(itv),
        interviewStatus: itv.Status as RsvpSummary['interviewStatus'],
        currentResponse: p.Rsvp as RsvpSummary['currentResponse'],
        respondedAt: p.RsvpAt ? p.RsvpAt.toISOString() : undefined,
      };
    }

    return {
      scope: 'candidate',
      recipientName: itv.application?.CandidateName ?? 'Candidat',
      jobOfferTitle: itv.application?.JobOfferTitle ?? 'Poste',
      scheduledAt: itv.ScheduledAt.toISOString(),
      mode: itv.Mode,
      place: this.placeOf(itv),
      interviewStatus: itv.Status as RsvpSummary['interviewStatus'],
      currentResponse: itv.CandidateRsvp as RsvpSummary['currentResponse'],
      respondedAt: itv.CandidateRsvpAt ? itv.CandidateRsvpAt.toISOString() : undefined,
    };
  }

  // ── POST public : enregistre la reponse ────────────────────────────────
  async record(token: string, response: 'accepted' | 'declined' | 'tentative') {
    const resolved = await this.resolveToken(token);
    const itv = resolved.interview;

    if (itv.Status === 'Cancelled') {
      throw new BadRequestException('Cet entretien a ete annule');
    }
    if (itv.Status === 'Done') {
      throw new BadRequestException('Cet entretien a deja eu lieu');
    }
    if (itv.Status !== 'Scheduled') {
      throw new BadRequestException("Cet entretien n'accepte plus de reponse");
    }

    const dbValue = LINK_RESPONSE_TO_DB[response];
    const now = new Date();

    if (resolved.scope === 'participant') {
      await this.prisma.interviewParticipant.updateMany({
        where: { RsvpToken: token },
        data: { Rsvp: dbValue, RsvpAt: now, RsvpSource: 'Link' },
      });
    } else {
      await this.prisma.interview.updateMany({
        where: { CandidateRsvpToken: token },
        data: { CandidateRsvp: dbValue, CandidateRsvpAt: now, CandidateRsvpSource: 'Link' },
      });
    }

    const who =
      resolved.scope === 'participant'
        ? itv.participants.find((row) => row.Id === resolved.participantId)?.Name ?? 'Un participant'
        : itv.application?.CandidateName ?? 'Le candidat';
    const jobTitle = itv.application?.JobOfferTitle ?? 'Poste';
    const when = this.formatInterviewDate(itv.ScheduledAt);
    this.afterWrite(
      itv,
      `${who} ${this.verbFr(dbValue)} l'entretien du ${when} pour le poste "${jobTitle}"`,
    );

    return { status: 'recorded', response };
  }

  // ── Correction manuelle par un RH ─────────────────────────────────────
  async setRsvpManual(interviewId: string, dto: ManualRsvpDto, actorId: string) {
    const itv = await this.loadInterview(interviewId);
    if (!itv) {
      throw new NotFoundException(`Entretien ${interviewId} introuvable`);
    }

    const now = new Date();
    const clearing = dto.Response === 'Pending';
    const source = clearing ? null : 'Manual';
    const at = clearing ? null : now;

    if (dto.Target === 'candidate') {
      await this.prisma.interview.update({
        where: { Id: interviewId },
        data: {
          CandidateRsvp: dto.Response,
          CandidateRsvpAt: at,
          CandidateRsvpSource: source,
          ModifiedBy: actorId,
          ModifiedAt: now,
        },
      });
    } else {
      const participant = itv.participants.find((row) => row.Id === dto.Target);
      if (!participant) {
        throw new BadRequestException('Participant introuvable pour cet entretien');
      }
      await this.prisma.$transaction([
        this.prisma.interviewParticipant.update({
          where: { Id: participant.Id },
          data: { Rsvp: dto.Response, RsvpAt: at, RsvpSource: source },
        }),
        this.prisma.interview.update({
          where: { Id: interviewId },
          data: { ModifiedBy: actorId, ModifiedAt: now },
        }),
      ]);
    }

    this.notify.broadcast();
  }

  // ── Mecanisme secondaire optionnel : .ics METHOD:REPLY transfere ──────
  async inboundIcs(secret: string | undefined, ics: string) {
    const expected = process.env.RSVP_INBOUND_SECRET;
    // Endpoint invisible (404, pas 401) tant que le secret n'est pas configure
    // ou que l'entete ne correspond pas.
    if (!expected || !secret || !this.secretMatches(secret, expected)) {
      throw new NotFoundException('Ressource introuvable');
    }

    const unfolded = ics.replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '');
    const lines = unfolded.split(/\r?\n/);

    const method = this.icsValue(lines, 'METHOD');
    if (!method || method.toUpperCase() !== 'REPLY') {
      return { status: 'ignored' };
    }
    const uid = this.icsValue(lines, 'UID');
    const uidMatch = uid ? INTERVIEW_UID_RE.exec(uid) : null;
    if (!uidMatch) {
      return { status: 'ignored' };
    }

    const interview = await this.loadInterview(uidMatch[1].toLowerCase());
    if (!interview) {
      return { status: 'ignored' };
    }

    const candidateEmail = interview.application?.CandidateEmail?.toLowerCase() ?? null;
    let updated = 0;

    for (const line of lines) {
      if (!/^ATTENDEE[;:]/i.test(line)) continue;
      const partstat = /PARTSTAT=([A-Za-z-]+)/i.exec(line)?.[1]?.toUpperCase();
      const email = /mailto:([^\s;:>]+)/i.exec(line)?.[1]?.toLowerCase();
      if (!partstat || !email) continue;
      const dbValue = PARTSTAT_TO_DB[partstat];
      if (!dbValue) continue;
      const now = new Date();

      const participant = interview.participants.find(
        (row) => (row.Email ?? '').toLowerCase() === email,
      );
      if (participant) {
        await this.prisma.interviewParticipant.update({
          where: { Id: participant.Id },
          data: { Rsvp: dbValue, RsvpAt: now, RsvpSource: 'IcsReply' },
        });
        updated += 1;
        continue;
      }
      if (candidateEmail && candidateEmail === email) {
        await this.prisma.interview.update({
          where: { Id: interview.Id },
          data: { CandidateRsvp: dbValue, CandidateRsvpAt: now, CandidateRsvpSource: 'IcsReply' },
        });
        updated += 1;
      }
    }

    if (updated > 0) this.notify.broadcast();
    return { status: updated > 0 ? 'recorded' : 'ignored', updated };
  }

  // ── Helpers ──────────────────────────────────────────────────────────
  private secretMatches(got: string, expected: string): boolean {
    const a = Buffer.from(got);
    const b = Buffer.from(expected);
    if (a.length !== b.length) return false;
    try {
      return timingSafeEqual(a, b);
    } catch {
      return false;
    }
  }

  private icsValue(lines: string[], key: string): string | null {
    const upper = key.toUpperCase();
    for (const line of lines) {
      const idx = line.indexOf(':');
      if (idx < 0) continue;
      const rawKey = line.slice(0, idx).split(';')[0]!.trim().toUpperCase();
      if (rawKey === upper) return line.slice(idx + 1).trim();
    }
    return null;
  }

  // Date + heure lisibles pour le message de notification (jamais relatif
  // "demain"/"hier" ici : le RH peut lire cette notification des jours plus
  // tard, une date relative deviendrait fausse a ce moment-la).
  private formatInterviewDate(d: Date): string {
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = d.getFullYear();
    const hh = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    return `${dd}/${mm}/${yyyy} a ${hh}h${min}`;
  }

  private verbFr(value: 'Accepted' | 'Declined' | 'Tentative'): string {
    if (value === 'Accepted') return 'a accepte';
    if (value === 'Declined') return 'a decline';
    return 'a repondu peut-etre pour';
  }

  private afterWrite(interview: LoadedInterview, message: string): void {
    this.notify.broadcast();
    if (!interview.CreatedBy) return;
    this.notifications
      .create({
        employeeId: interview.CreatedBy,
        type: 'recruitment',
        title: 'Reponse a une invitation entretien',
        message,
        href: '/hr/recruitment/interviews',
      })
      .catch((err) =>
        this.logger.error(
          'Notification RSVP entretien echouee',
          err instanceof Error ? err.stack : String(err),
        ),
      );
  }
}

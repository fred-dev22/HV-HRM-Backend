import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationService } from '../notification/notification.service';
import { MailService } from '../mail/mail.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { renderEmailHtml, frontendOrigin, EmailAccent, EmailActionButton } from '../mail/email-templates';
import { buildInviteIcs, IcsAttendee } from './ics.util';

// Lien de la page publique de reponse a une invitation entretien (backlog
// "Suivi des reponses"). La page (SPA) appelle ensuite l'API ; le lien reste
// un GET sans effet de bord, seul le clic sur la page enregistre la reponse.
function rsvpUrl(token: string, response: 'accepted' | 'declined' | 'tentative'): string {
  return `${frontendOrigin()}/entretien-rsvp/${token}?response=${response}`;
}

// Effets de bord du module Recrutement regroupes ici : rafraichissement
// temps reel des ecrans, notifications in-app (cloche) au recruteur, emails
// aux candidats et aux participants d'entretien (avec invitation calendrier
// .ics, US13-14). Aucune de ces methodes ne leve : un email ou une
// notification qui echoue ne doit jamais faire echouer l'action metier.
@Injectable()
export class RecruitmentNotifyService {
  private readonly logger = new Logger(RecruitmentNotifyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
    private readonly mail: MailService,
    private readonly realtime: RealtimeGateway,
  ) {}

  // Signale a tous les ecrans du module qu'une donnee a change (meme canal
  // que les autres domaines, voir RealtimeGateway.broadcastCompany).
  broadcast(): void {
    this.realtime.broadcastCompany('data:changed', { domain: 'recruitment' });
  }

  // Notifie le recruteur (cloche + email) de l'issue d'une etape post-
  // entretien (proposition envoyee, negociation, acceptation, refus...).
  async notifyRecruiter(
    recruiterEmployeeId: string | null | undefined,
    opts: { title: string; message: string; href?: string; accent?: EmailAccent },
  ): Promise<void> {
    if (!recruiterEmployeeId) return;
    try {
      await this.notifications.create({
        employeeId: recruiterEmployeeId,
        type: 'recruitment',
        title: opts.title,
        message: opts.message,
        href: opts.href,
      });
    } catch (err) {
      this.logger.error('Notification recruteur echouee', err instanceof Error ? err.stack : String(err));
    }
    try {
      const recruiter = await this.prisma.employee.findUnique({
        where: { Id: recruiterEmployeeId },
        select: { Email: true, FirstName: true },
      });
      if (recruiter?.Email) {
        await this.mail.send({
          to: recruiter.Email,
          subject: opts.title,
          html: renderEmailHtml({
            accent: opts.accent ?? 'primary',
            chipLabel: 'Recrutement',
            title: opts.title,
            bodyLines: [
              `Bonjour ${recruiter.FirstName},`,
              opts.message,
            ],
            ctaLabel: opts.href ? 'Ouvrir dans HRM' : undefined,
            ctaHref: opts.href ? `${frontendOrigin()}${opts.href}` : undefined,
          }),
        });
      }
    } catch (err) {
      this.logger.error('Email recruteur echoue', err instanceof Error ? err.stack : String(err));
    }
  }

  // Email simple a un candidat (accuse de reception, refus, convocation...).
  async emailCandidate(
    to: string,
    subject: string,
    opts: { accent?: EmailAccent; title: string; bodyLines: string[] },
  ): Promise<void> {
    if (!to) return;
    try {
      await this.mail.send({
        to,
        subject,
        html: renderEmailHtml({
          accent: opts.accent ?? 'primary',
          chipLabel: 'Recrutement',
          title: opts.title,
          bodyLines: opts.bodyLines,
        }),
      });
    } catch (err) {
      this.logger.error(`Email candidat echoue (${to})`, err instanceof Error ? err.stack : String(err));
    }
  }

  // Invitations calendrier d'un entretien (US13-14) : une invitation .ics est
  // envoyee au candidat et a chaque participant qui a une adresse email. Une
  // requete d'envoi par destinataire (MailService.send est mono-destinataire).
  async sendInterviewInvites(params: {
    interviewId: string;
    sequence: number;
    method: 'REQUEST' | 'CANCEL';
    start: Date;
    durationMinutes: number;
    candidateName: string;
    candidateEmail: string;
    jobOfferTitle: string;
    mode: string;
    location?: string | null;
    meetingLink?: string | null;
    organizerName: string;
    organizerEmail: string;
    // Jeton RSVP opaque du candidat (pose sur l'entretien) ; null si l'entretien
    // est anterieur a la fonctionnalite ou si aucun jeton n'a ete emis.
    candidateRsvpToken: string | null;
    // Un jeton RSVP par participant (null = pas de jeton -> pas de boutons).
    participants: Array<{ name: string; email: string; rsvpToken: string | null }>;
  }): Promise<void> {
    const end = new Date(params.start.getTime() + params.durationMinutes * 60_000);
    const place =
      params.mode === 'VideoCall'
        ? params.meetingLink ?? 'Visioconference'
        : params.location ?? 'Sur site';
    const summary = `Entretien - ${params.candidateName} - ${params.jobOfferTitle}`;
    const description =
      params.method === 'CANCEL'
        ? `L'entretien pour le poste "${params.jobOfferTitle}" a ete annule.`
        : `Entretien de recrutement pour le poste "${params.jobOfferTitle}".\n` +
          `Candidat : ${params.candidateName}\n` +
          (params.mode === 'VideoCall' && params.meetingLink ? `Lien : ${params.meetingLink}\n` : '') +
          (params.mode === 'InPerson' && params.location ? `Lieu : ${params.location}\n` : '');

    const attendees: IcsAttendee[] = [
      { name: params.candidateName, email: params.candidateEmail },
      ...params.participants,
    ].filter((a) => !!a.email);

    // email (minuscule) -> jeton RSVP, pour ajouter les boutons Accepter /
    // Refuser / Peut-etre dans l'email d'invitation (jamais pour une annulation).
    const rsvpTokenByEmail = new Map<string, string>();
    if (params.candidateEmail && params.candidateRsvpToken) {
      rsvpTokenByEmail.set(params.candidateEmail.toLowerCase(), params.candidateRsvpToken);
    }
    for (const p of params.participants) {
      if (p.email && p.rsvpToken) rsvpTokenByEmail.set(p.email.toLowerCase(), p.rsvpToken);
    }

    const ics = buildInviteIcs({
      uid: `interview-${params.interviewId}@productive247`,
      sequence: params.sequence,
      method: params.method,
      start: params.start,
      end,
      summary,
      description,
      location: place,
      organizerName: params.organizerName,
      organizerEmail: params.organizerEmail,
      attendees,
    });
    const contentBytes = Buffer.from(ics, 'utf-8').toString('base64');
    const verb = params.method === 'CANCEL' ? 'Annulation' : 'Invitation';

    for (const a of attendees) {
      const rsvpToken = params.method === 'REQUEST' ? rsvpTokenByEmail.get(a.email.toLowerCase()) : undefined;
      const actionButtons: EmailActionButton[] | undefined = rsvpToken
        ? [
            { label: 'Accepter', color: 'primary', href: rsvpUrl(rsvpToken, 'accepted') },
            { label: 'Refuser', color: 'danger', href: rsvpUrl(rsvpToken, 'declined') },
            { label: 'Peut-etre', color: 'warning', href: rsvpUrl(rsvpToken, 'tentative') },
          ]
        : undefined;
      try {
        await this.mail.send({
          to: a.email,
          subject: `${verb} entretien - ${params.candidateName} (${params.jobOfferTitle})`,
          html: renderEmailHtml({
            accent: params.method === 'CANCEL' ? 'danger' : 'primary',
            chipLabel: 'Entretien',
            title: params.method === 'CANCEL' ? 'Entretien annule' : 'Invitation a un entretien',
            bodyLines: [
              `Bonjour ${a.name},`,
              params.method === 'CANCEL'
                ? `L'entretien pour le poste <strong>${params.jobOfferTitle}</strong> (candidat ${params.candidateName}) a ete annule.`
                : `Vous etes invite(e) a l'entretien de recrutement pour le poste <strong>${params.jobOfferTitle}</strong>.`,
            ],
            details:
              params.method === 'CANCEL'
                ? undefined
                : [
                    { label: 'Candidat', value: params.candidateName },
                    { label: 'Date', value: params.start.toLocaleString('fr-FR') },
                    { label: params.mode === 'VideoCall' ? 'Lien' : 'Lieu', value: place },
                  ],
            actionButtons,
          }),
          attachments: [
            {
              name: 'entretien.ics',
              contentType: `text/calendar; method=${params.method}; charset=UTF-8`,
              contentBytes,
            },
          ],
        });
      } catch (err) {
        this.logger.error(`Invitation entretien echouee (${a.email})`, err instanceof Error ? err.stack : String(err));
      }
    }
  }
}

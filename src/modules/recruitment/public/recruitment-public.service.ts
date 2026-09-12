import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { RecruitmentNotifyService } from '../recruitment-notify.service';
import { REFERENCE_PREFIXES } from '../recruitment.constants';
import { nextReferenceCode, resolvePortalAuthorId, withReferenceCodeRetry } from '../recruitment.util';
import { RecruitmentAttachmentService } from '../attachments/recruitment-attachment.service';
import { assertNotEmpty } from '../attachments/recruitment-upload.util';
import { JobFeedService } from '../distribution/job-feed.service';
import { TurnstileService } from './turnstile.service';
import {
  HONEYPOT_FIELDS,
  issueFormToken,
  formTokenHints,
  verifyFormToken,
} from './careers-antispam.util';
import { PublicApplyDto } from './dto/public-apply.dto';

// 10 minutes : fenetre de deduplication des depots publics (double-clic,
// retry reseau, bot). Cle = email + offre (email seul pour une spontanee).
const DEDUP_WINDOW_MS = 10 * 60 * 1000;

// Portail carriere public — aucune authentification. Les offres sont
// adressees par leur jeton opaque (JobOffer.PublicToken), jamais par leur id
// interne. L'anti-spam (pot-de-miel, jeton de formulaire, limitation de
// debit, Turnstile) est branche ici et sur SlidingWindowRateLimitGuard
// (routes @Public, pilote par l'environnement, defauts permissifs).
@Injectable()
export class RecruitmentPublicService {
  private readonly logger = new Logger(RecruitmentPublicService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notify: RecruitmentNotifyService,
    private readonly attachments: RecruitmentAttachmentService,
    private readonly turnstile: TurnstileService,
    private readonly jobFeed: JobFeedService,
  ) {}

  private publicShape(o: {
    Title: string;
    EntityName: string;
    ContractType: string;
    Location: string;
    Description: string;
    SalaryText: string | null;
    PublishedAt: Date | null;
    PublicToken: string;
    Views: number;
  }) {
    return {
      title: o.Title,
      entityName: o.EntityName,
      contractType: o.ContractType,
      location: o.Location,
      description: o.Description,
      salaryText: o.SalaryText ?? undefined,
      publishedAt: o.PublishedAt,
      token: o.PublicToken,
      views: o.Views,
    };
  }

  async listPublished() {
    const offers = await this.prisma.jobOffer.findMany({
      where: { Status: 'Published', IsDeleted: false },
      orderBy: { PublishedAt: 'desc' },
    });
    return offers.map((o) => this.publicShape(o));
  }

  async getByToken(token: string, countView: boolean) {
    const offer = await this.prisma.jobOffer.findFirst({
      where: { PublicToken: token, Status: 'Published', IsDeleted: false },
    });
    if (!offer) {
      throw new NotFoundException("Cette offre n'existe plus ou n'est pas publiee");
    }
    if (countView) {
      await this.prisma.jobOffer.update({ where: { Id: offer.Id }, data: { Views: { increment: 1 } } });
    }
    return {
      ...this.publicShape({ ...offer, Views: offer.Views + (countView ? 1 : 0) }),
      // Embarque un jeton de formulaire pour eviter un aller-retour supplementaire.
      formToken: issueFormToken(),
    };
  }

  // Jeton de formulaire sans etat + indices de duree pour le SPA.
  issueFormToken(): { formToken: string; minSeconds: number; maxMinutes: number } {
    const { minSeconds, maxMinutes } = formTokenHints();
    return { formToken: issueFormToken(), minSeconds, maxMinutes };
  }

  // Flux publics des offres publiees — delegue a JobFeedService (rendu
  // memoise 60s, ne touche jamais Views).
  feedJson() {
    return this.jobFeed.getJson();
  }

  feedXml() {
    return this.jobFeed.getXml();
  }

  private portalAuthorId(): Promise<string> {
    return resolvePortalAuthorId(this.prisma);
  }

  private async refCode() {
    return nextReferenceCode(REFERENCE_PREFIXES.application, (p) =>
      this.prisma.recruitmentApplication.count({ where: { ReferenceCode: { startsWith: p } } }),
    );
  }

  // ── Anti-spam ──────────────────────────────────────────────────────────

  // Pot-de-miel : true => on laisse tomber la soumission en silence.
  private isHoneypotTripped(dto: PublicApplyDto): boolean {
    return HONEYPOT_FIELDS.some((f) => {
      const v = (dto as unknown as Record<string, unknown>)[f];
      return typeof v === 'string' && v.trim().length > 0;
    });
  }

  // Jeton de formulaire -> BadRequestException FR selon le motif de rejet.
  private assertFormToken(token?: string): void {
    switch (verifyFormToken(token)) {
      case 'ok':
        return;
      case 'too_young':
        throw new BadRequestException(
          'Merci de prendre le temps de remplir le formulaire, puis de reessayer.',
        );
      case 'reused':
        throw new BadRequestException('Cette candidature a deja ete envoyee.');
      case 'missing':
      case 'too_old':
      case 'bad':
      default:
        throw new BadRequestException('Ce formulaire a expire, merci de recharger la page.');
    }
  }

  // Laisse au drop pot-de-miel la meme latence qu'une vraie soumission.
  private async honeypotJitter(): Promise<void> {
    const ms = 150 + Math.floor(Math.random() * 250);
    await new Promise((r) => setTimeout(r, ms));
  }

  // Prelude anti-spam commun aux deux endpoints d'envoi. Retourne true si la
  // soumission doit etre abandonnee silencieusement (pot-de-miel).
  private async screenSubmission(dto: PublicApplyDto, ip: string): Promise<boolean> {
    if (this.isHoneypotTripped(dto)) {
      this.logger.debug(`pot-de-miel declenche depuis ${ip}`);
      return true;
    }
    this.assertFormToken(dto.FormToken);
    const cap = await this.turnstile.verify(dto.CaptchaToken, ip);
    if (!cap.ok) {
      throw new BadRequestException('La verification anti-robot a echoue, merci de reessayer.');
    }
    return false;
  }

  // ── Depot de candidature ──────────────────────────────────────────────

  async applyToOffer(token: string, dto: PublicApplyDto, cv: Express.Multer.File | undefined, ip: string) {
    if (await this.screenSubmission(dto, ip)) {
      await this.honeypotJitter();
      // Meme forme/HTTP qu'un vrai envoi, mais AUCUN effet de bord.
      return { ok: true, referenceCode: 'CD-0000-00000' };
    }

    const offer = await this.prisma.jobOffer.findFirst({
      where: { PublicToken: token, Status: 'Published', IsDeleted: false },
    });
    if (!offer) {
      throw new NotFoundException("Cette offre n'est plus disponible");
    }
    assertNotEmpty(cv);

    // Deduplication : meme email + meme offre dans les 10 dernieres minutes.
    const since = new Date(Date.now() - DEDUP_WINDOW_MS);
    const duplicate = await this.prisma.recruitmentApplication.findFirst({
      where: {
        IsDeleted: false,
        JobOfferId: offer.Id,
        CandidateEmail: dto.CandidateEmail,
        AppliedAt: { gte: since },
      },
      orderBy: { AppliedAt: 'desc' },
    });
    if (duplicate) {
      return { ok: true, referenceCode: duplicate.ReferenceCode };
    }

    const authorId = await this.portalAuthorId();
    const uploaded = await this.attachments.uploadToSharePoint(cv as Express.Multer.File);

    const app = await withReferenceCodeRetry(() =>
      this.prisma.$transaction(async (tx) => {
        const created = await tx.recruitmentApplication.create({
          data: {
            ReferenceCode: await this.refCode(),
            JobOfferId: offer.Id,
            JobOfferTitle: offer.Title,
            CandidateName: dto.CandidateName,
            CandidateEmail: dto.CandidateEmail,
            CandidatePhone: dto.CandidatePhone,
            Source: 'Offer',
            CvFileName: uploaded.fileName,
            Status: 'New',
            AppliedAt: new Date(),
            CreatedBy: authorId,
          },
        });
        await tx.attachment.create({
          data: this.attachments.attachmentData('RecruitmentApplication', created.Id, uploaded, authorId),
        });
        return created;
      }),
    );

    await this.notify.emailCandidate(dto.CandidateEmail, 'Candidature bien recue', {
      title: 'Candidature enregistree',
      bodyLines: [
        `Bonjour ${dto.CandidateName},`,
        `Nous avons bien recu votre candidature pour le poste <strong>${offer.Title}</strong>. Notre equipe RH revient vers vous.`,
      ],
    });
    await this.notify.notifyRecruiter(offer.CreatedBy, {
      title: 'Nouvelle candidature',
      message: `${dto.CandidateName} a postule a l'offre "${offer.Title}".`,
      href: '/hr/recruitment/applications',
    });
    this.notify.broadcast();
    return { ok: true, referenceCode: app.ReferenceCode };
  }

  async applySpontaneous(dto: PublicApplyDto, cv: Express.Multer.File | undefined, ip: string) {
    if (await this.screenSubmission(dto, ip)) {
      await this.honeypotJitter();
      return { ok: true, referenceCode: 'CD-0000-00000' };
    }

    assertNotEmpty(cv);

    const since = new Date(Date.now() - DEDUP_WINDOW_MS);
    const duplicate = await this.prisma.recruitmentApplication.findFirst({
      where: {
        IsDeleted: false,
        JobOfferId: null,
        Source: 'Spontaneous',
        CandidateEmail: dto.CandidateEmail,
        AppliedAt: { gte: since },
      },
      orderBy: { AppliedAt: 'desc' },
    });
    if (duplicate) {
      return { ok: true, referenceCode: duplicate.ReferenceCode };
    }

    const authorId = await this.portalAuthorId();
    const uploaded = await this.attachments.uploadToSharePoint(cv as Express.Multer.File);

    const app = await withReferenceCodeRetry(() =>
      this.prisma.$transaction(async (tx) => {
        const created = await tx.recruitmentApplication.create({
          data: {
            ReferenceCode: await this.refCode(),
            CandidateName: dto.CandidateName,
            CandidateEmail: dto.CandidateEmail,
            CandidatePhone: dto.CandidatePhone,
            Source: 'Spontaneous',
            CvFileName: uploaded.fileName,
            Status: 'New',
            AppliedAt: new Date(),
            CreatedBy: authorId,
          },
        });
        await tx.attachment.create({
          data: this.attachments.attachmentData('RecruitmentApplication', created.Id, uploaded, authorId),
        });
        return created;
      }),
    );

    await this.notify.emailCandidate(dto.CandidateEmail, 'Candidature spontanee bien recue', {
      title: 'Candidature spontanee enregistree',
      bodyLines: [
        `Bonjour ${dto.CandidateName},`,
        'Nous avons bien recu votre candidature spontanee. Elle rejoint notre vivier ; nous vous recontacterons si un poste correspond a votre profil.',
      ],
    });
    this.notify.broadcast();
    return { ok: true, referenceCode: app.ReferenceCode };
  }
}

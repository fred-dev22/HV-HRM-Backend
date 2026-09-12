import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { RecruitmentNotifyService } from '../recruitment-notify.service';
import { REFERENCE_PREFIXES, APPLICATION_EDITABLE_STATUSES } from '../recruitment.constants';
import { nextReferenceCode, joinTags, withReferenceCodeRetry } from '../recruitment.util';
import { RecruitmentAttachmentService } from '../attachments/recruitment-attachment.service';
import {
  CreateApplicationDto,
  UpdateApplicationDto,
  SetApplicationStatusDto,
  AddApplicationNoteDto,
  AddToTalentPoolDto,
} from './dto/application.dto';

const INCLUDE = {
  jobOffer: { select: { Id: true, ReferenceCode: true, Title: true, Status: true } },
  employee: { select: { Id: true, FullName: true, Email: true } },
  createdByEmployee: { select: { Id: true, FullName: true } },
  notes: { orderBy: { CreatedAt: 'desc' as const } },
  interviews: {
    where: { IsDeleted: false },
    select: { Id: true, ReferenceCode: true, ScheduledAt: true, Status: true },
    orderBy: { ScheduledAt: 'desc' as const },
  },
  contract: { select: { Id: true, ReferenceCode: true, Status: true } },
} as const;

@Injectable()
export class ApplicationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notify: RecruitmentNotifyService,
    private readonly attachments: RecruitmentAttachmentService,
  ) {}

  private async findRaw(id: string) {
    const row = await this.prisma.recruitmentApplication.findUnique({ where: { Id: id } });
    if (!row || row.IsDeleted) {
      throw new NotFoundException(`Candidature ${id} introuvable`);
    }
    return row;
  }

  private async refCode() {
    return nextReferenceCode(REFERENCE_PREFIXES.application, (p) =>
      this.prisma.recruitmentApplication.count({ where: { ReferenceCode: { startsWith: p } } }),
    );
  }

  private async resolveOfferTitle(jobOfferId?: string): Promise<string | undefined> {
    if (!jobOfferId) return undefined;
    const offer = await this.prisma.jobOffer.findUnique({ where: { Id: jobOfferId } });
    if (!offer || offer.IsDeleted) {
      throw new NotFoundException(`Offre ${jobOfferId} introuvable`);
    }
    return offer.Title;
  }

  async findAll(filter: { source?: string; jobOfferId?: string }) {
    return this.prisma.recruitmentApplication.findMany({
      where: {
        IsDeleted: false,
        ...(filter.source ? { Source: filter.source } : {}),
        ...(filter.jobOfferId ? { JobOfferId: filter.jobOfferId } : {}),
      },
      include: INCLUDE,
      orderBy: { AppliedAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const row = await this.prisma.recruitmentApplication.findUnique({ where: { Id: id }, include: INCLUDE });
    if (!row || row.IsDeleted) {
      throw new NotFoundException(`Candidature ${id} introuvable`);
    }
    return row;
  }

  async create(dto: CreateApplicationDto, employeeId: string, cv?: Express.Multer.File) {
    const jobOfferTitle = await this.resolveOfferTitle(dto.JobOfferId);
    // Upload SharePoint AVANT la transaction : un appel reseau long ne doit
    // pas maintenir une transaction DB ouverte. Si l'upload echoue (503),
    // aucune candidature n'est creee.
    const uploaded = cv ? await this.attachments.uploadToSharePoint(cv) : null;
    const row = await withReferenceCodeRetry(() =>
      this.prisma.$transaction(async (tx) => {
        const created = await tx.recruitmentApplication.create({
          data: {
            ReferenceCode: await this.refCode(),
            JobOfferId: dto.JobOfferId,
            JobOfferTitle: jobOfferTitle,
            CandidateName: dto.CandidateName,
            CandidateEmail: dto.CandidateEmail,
            CandidatePhone: dto.CandidatePhone,
            Source: dto.Source,
            CvFileName: uploaded ? uploaded.fileName : dto.CvFileName,
            Status: 'New',
            AppliedAt: new Date(),
            CreatedBy: employeeId,
          },
          include: INCLUDE,
        });
        if (uploaded) {
          await tx.attachment.create({
            data: this.attachments.attachmentData(
              'RecruitmentApplication',
              created.Id,
              uploaded,
              employeeId,
            ),
          });
        }
        return created;
      }),
    );
    this.notify.broadcast();
    return row;
  }

  // Pieces jointes d'une candidature (CV reel + documents annexes). Portees
  // par des lignes Attachment polymorphes ; RECRUTEMENT_ACCES (classe du
  // controleur) suffit, pas de controle proprietaire.
  async listDocuments(id: string) {
    const app = await this.findRaw(id);
    return this.attachments.listFor('RecruitmentApplication', id, app.CvFileName);
  }

  async addDocument(
    id: string,
    file: Express.Multer.File | undefined,
    employeeId: string,
    setPrimaryCv: boolean,
  ) {
    const app = await this.findRaw(id);
    if (!file) {
      throw new BadRequestException('Le fichier est obligatoire.');
    }
    const uploaded = await this.attachments.uploadToSharePoint(file);
    const doc = await this.prisma.$transaction(async (tx) => {
      const created = await tx.attachment.create({
        data: this.attachments.attachmentData('RecruitmentApplication', id, uploaded, employeeId),
      });
      if (setPrimaryCv) {
        await tx.recruitmentApplication.update({
          where: { Id: id },
          data: { CvFileName: uploaded.fileName, ModifiedBy: employeeId, ModifiedAt: new Date() },
        });
      }
      return created;
    });
    this.notify.broadcast();
    return this.attachments.shapeDoc(doc, setPrimaryCv ? uploaded.fileName : app.CvFileName);
  }

  async removeDocument(id: string, attachmentId: string, employeeId: string) {
    const app = await this.findRaw(id);
    const removed = await this.attachments.removeFor(
      'RecruitmentApplication',
      id,
      attachmentId,
      'Document introuvable pour cette candidature',
    );
    if (app.CvFileName && removed.FileName === app.CvFileName) {
      await this.prisma.recruitmentApplication.update({
        where: { Id: id },
        data: { CvFileName: null, ModifiedBy: employeeId, ModifiedAt: new Date() },
      });
    }
    this.notify.broadcast();
    return { ok: true };
  }

  // Candidature interne (mobilite, US12) : un employe deja dans le systeme
  // postule lui-meme a une offre publiee, depuis son espace.
  async selfApply(jobOfferId: string, employeeId: string) {
    const offer = await this.prisma.jobOffer.findUnique({ where: { Id: jobOfferId } });
    if (!offer || offer.IsDeleted) {
      throw new NotFoundException(`Offre ${jobOfferId} introuvable`);
    }
    if (offer.Status !== 'Published') {
      throw new BadRequestException("Cette offre n'est pas ouverte aux candidatures");
    }
    const me = await this.prisma.employee.findUniqueOrThrow({
      where: { Id: employeeId },
      select: { FullName: true, Email: true, MobilePhone: true },
    });
    const already = await this.prisma.recruitmentApplication.findFirst({
      where: { JobOfferId: jobOfferId, EmployeeId: employeeId, IsDeleted: false },
    });
    if (already) {
      throw new BadRequestException('Vous avez deja postule a cette offre');
    }
    const row = await this.prisma.recruitmentApplication.create({
      data: {
        ReferenceCode: await this.refCode(),
        JobOfferId: jobOfferId,
        JobOfferTitle: offer.Title,
        CandidateName: me.FullName,
        CandidateEmail: me.Email,
        CandidatePhone: me.MobilePhone ?? '',
        Source: 'Internal',
        EmployeeId: employeeId,
        Status: 'New',
        AppliedAt: new Date(),
        CreatedBy: employeeId,
      },
      include: INCLUDE,
    });
    // Notifie le recruteur (createur de l'offre) de la candidature interne.
    await this.notify.notifyRecruiter(offer.CreatedBy, {
      title: 'Nouvelle candidature interne',
      message: `${me.FullName} a postule en interne a l'offre "${offer.Title}".`,
      href: '/hr/recruitment/applications',
    });
    this.notify.broadcast();
    return row;
  }

  findMineInternal(employeeId: string) {
    return this.prisma.recruitmentApplication.findMany({
      where: { EmployeeId: employeeId, Source: 'Internal', IsDeleted: false },
      include: INCLUDE,
      orderBy: { AppliedAt: 'desc' },
    });
  }

  // Offres publiees vues par un employe pour postuler en interne (US12) —
  // aucune permission recrutement requise, donc version allegee.
  listPublishedOffersLite() {
    return this.prisma.jobOffer.findMany({
      where: { Status: 'Published', IsDeleted: false },
      select: {
        Id: true,
        ReferenceCode: true,
        Title: true,
        EntityName: true,
        ContractType: true,
        Location: true,
        Description: true,
      },
      orderBy: { PublishedAt: 'desc' },
    });
  }

  // Desistement d'une candidature interne par l'employe lui-meme (US12).
  async withdrawOwn(id: string, employeeId: string) {
    const app = await this.findRaw(id);
    if (app.EmployeeId !== employeeId || app.Source !== 'Internal') {
      throw new NotFoundException(`Candidature ${id} introuvable`);
    }
    if (!['New', 'InReview', 'InterviewScheduled'].includes(app.Status)) {
      throw new BadRequestException('Cette candidature ne peut plus etre retiree');
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.applicationNote.create({
        data: { ApplicationId: id, AuthorName: app.CandidateName, Text: 'Candidat desiste de sa candidature interne.' },
      });
      await tx.recruitmentApplication.update({
        where: { Id: id },
        data: { Status: 'Rejected', ModifiedBy: employeeId, ModifiedAt: new Date() },
      });
    });
    this.notify.broadcast();
    return { ok: true };
  }

  async update(id: string, dto: UpdateApplicationDto, employeeId: string) {
    const existing = await this.findRaw(id);
    if (!APPLICATION_EDITABLE_STATUSES.includes(existing.Status)) {
      throw new BadRequestException(
        'Une candidature deja en entretien ou traitee ne peut plus etre modifiee',
      );
    }
    const jobOfferTitle =
      dto.JobOfferId !== undefined
        ? await this.resolveOfferTitle(dto.JobOfferId)
        : existing.JobOfferTitle ?? undefined;
    const row = await this.prisma.recruitmentApplication.update({
      where: { Id: id },
      data: {
        JobOfferId: dto.JobOfferId !== undefined ? dto.JobOfferId : existing.JobOfferId,
        JobOfferTitle: jobOfferTitle,
        CandidateName: dto.CandidateName ?? existing.CandidateName,
        CandidateEmail: dto.CandidateEmail ?? existing.CandidateEmail,
        CandidatePhone: dto.CandidatePhone ?? existing.CandidatePhone,
        CvFileName: dto.CvFileName !== undefined ? dto.CvFileName : existing.CvFileName,
        ModifiedBy: employeeId,
        ModifiedAt: new Date(),
      },
      include: INCLUDE,
    });
    this.notify.broadcast();
    return row;
  }

  // Statut libre pilote a la main par le RH (pas de circuit). Un passage a
  // "Rejected" envoie un email de reponse negative au candidat.
  async setStatus(id: string, dto: SetApplicationStatusDto, employeeId: string) {
    const existing = await this.findRaw(id);
    const row = await this.prisma.recruitmentApplication.update({
      where: { Id: id },
      data: { Status: dto.Status, ModifiedBy: employeeId, ModifiedAt: new Date() },
      include: INCLUDE,
    });
    if (dto.Status === 'Rejected' && existing.Status !== 'Rejected' && existing.Source !== 'Internal') {
      await this.notify.emailCandidate(existing.CandidateEmail, 'Suite donnee a votre candidature', {
        accent: 'info',
        title: 'Votre candidature',
        bodyLines: [
          `Bonjour ${existing.CandidateName},`,
          'Nous vous remercions de l\'interet porte a notre entreprise. Apres etude, nous ne donnerons pas suite a votre candidature pour ce poste.',
          'Nous conservons votre profil et reviendrons vers vous si une opportunite correspond.',
        ],
      });
    }
    this.notify.broadcast();
    return row;
  }

  async addNote(id: string, dto: AddApplicationNoteDto, employeeId: string) {
    await this.findRaw(id);
    const author = await this.prisma.employee.findUnique({
      where: { Id: employeeId },
      select: { FullName: true },
    });
    await this.prisma.applicationNote.create({
      data: { ApplicationId: id, AuthorName: author?.FullName ?? 'RH', Text: dto.Text },
    });
    this.notify.broadcast();
    return this.findOne(id);
  }

  async addToTalentPool(id: string, dto: AddToTalentPoolDto, employeeId: string) {
    const app = await this.findRaw(id);
    const existing = await this.prisma.talentPoolEntry.findFirst({
      where: { SourceApplicationId: id, IsDeleted: false },
    });
    if (existing) {
      throw new BadRequestException('Ce candidat est deja dans le vivier');
    }
    const entry = await this.prisma.talentPoolEntry.create({
      data: {
        ReferenceCode: await nextReferenceCode(REFERENCE_PREFIXES.talentPool, (p) =>
          this.prisma.talentPoolEntry.count({ where: { ReferenceCode: { startsWith: p } } }),
        ),
        CandidateName: app.CandidateName,
        CandidateEmail: app.CandidateEmail,
        CandidatePhone: app.CandidatePhone,
        Tags: joinTags(dto.Tags ?? []),
        Notes: dto.Notes ?? '',
        SourceApplicationId: id,
        AddedAt: new Date(),
        Status: 'Open',
        CreatedBy: employeeId,
      },
    });
    this.notify.broadcast();
    return entry;
  }

  async remove(id: string, employeeId: string) {
    await this.findRaw(id);
    await this.prisma.recruitmentApplication.update({
      where: { Id: id },
      data: { IsDeleted: true, DeletedBy: employeeId, DeletedAt: new Date() },
    });
    this.notify.broadcast();
    return { ok: true };
  }
}

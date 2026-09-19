import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { RecruitmentNotifyService } from '../recruitment-notify.service';
import { REFERENCE_PREFIXES, TRIAL_PERIOD_MONTHS } from '../recruitment.constants';
import { nextReferenceCode } from '../recruitment.util';
import {
  GenerateContractDto,
  UpdateContractDto,
  NegotiateContractDto,
  AcceptContractDto,
  RefuseContractDto,
  ContractTemplateDto,
  UpdateContractTemplateDto,
} from './dto/contract.dto';

const INCLUDE = {
  application: {
    select: {
      Id: true,
      ReferenceCode: true,
      CandidateName: true,
      CandidateEmail: true,
      CandidatePhone: true,
      CreatedBy: true,
      JobOfferId: true,
      EmployeeId: true,
      employee: { select: { Id: true, FullName: true, Status: true, IsDeleted: true } },
    },
  },
  template: { select: { Id: true, Name: true, ContractType: true } },
  negotiationRounds: { orderBy: { RoundNo: 'asc' as const } },
  trialEmployee: { select: { Id: true, ReferenceCode: true, Status: true } },
} as const;

// Proposition d'embauche post-entretien. Pas de circuit de validation
// interne : le RH mene (Draft -> Sent -> Negotiating* -> Accepted | Refused),
// le recruteur (createur de la candidature / de l'offre) est notifie de
// chaque etape et surtout de l'issue.
@Injectable()
export class ContractService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notify: RecruitmentNotifyService,
  ) {}

  // ── Modeles de contrat ────────────────────────────────────────────────
  listTemplates() {
    return this.prisma.contractTemplate.findMany({
      where: { IsDeleted: false },
      orderBy: { Name: 'asc' },
    });
  }

  async createTemplate(dto: ContractTemplateDto, employeeId: string) {
    const row = await this.prisma.contractTemplate.create({
      data: { Name: dto.Name, ContractType: dto.ContractType, Content: dto.Content, CreatedBy: employeeId },
    });
    this.notify.broadcast();
    return row;
  }

  async updateTemplate(id: string, dto: UpdateContractTemplateDto, employeeId: string) {
    const existing = await this.prisma.contractTemplate.findUnique({ where: { Id: id } });
    if (!existing || existing.IsDeleted) {
      throw new NotFoundException(`Modele de contrat ${id} introuvable`);
    }
    const row = await this.prisma.contractTemplate.update({
      where: { Id: id },
      data: {
        Name: dto.Name ?? existing.Name,
        ContractType: dto.ContractType ?? existing.ContractType,
        Content: dto.Content ?? existing.Content,
        ModifiedBy: employeeId,
        ModifiedAt: new Date(),
      },
    });
    this.notify.broadcast();
    return row;
  }

  async removeTemplate(id: string, employeeId: string) {
    const existing = await this.prisma.contractTemplate.findUnique({ where: { Id: id } });
    if (!existing || existing.IsDeleted) {
      throw new NotFoundException(`Modele de contrat ${id} introuvable`);
    }
    await this.prisma.contractTemplate.update({
      where: { Id: id },
      data: { IsDeleted: true, DeletedBy: employeeId, DeletedAt: new Date() },
    });
    this.notify.broadcast();
    return { ok: true };
  }

  // ── Contrats ──────────────────────────────────────────────────────────
  private async findRaw(id: string) {
    const row = await this.prisma.recruitmentContract.findUnique({
      where: { Id: id },
      include: { application: true },
    });
    if (!row || row.IsDeleted) {
      throw new NotFoundException(`Contrat ${id} introuvable`);
    }
    return row;
  }

  list() {
    return this.prisma.recruitmentContract.findMany({
      where: { IsDeleted: false },
      include: INCLUDE,
      orderBy: { CreatedAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const row = await this.prisma.recruitmentContract.findUnique({ where: { Id: id }, include: INCLUDE });
    if (!row || row.IsDeleted) {
      throw new NotFoundException(`Contrat ${id} introuvable`);
    }
    return row;
  }

  // Candidatures "retenues" sans contrat — cible du selecteur "Generer un contrat".
  async eligibleApplications() {
    return this.prisma.recruitmentApplication.findMany({
      where: { IsDeleted: false, Status: 'Retained', contract: null },
      select: {
        Id: true,
        ReferenceCode: true,
        CandidateName: true,
        CandidateEmail: true,
        JobOfferTitle: true,
      },
      orderBy: { AppliedAt: 'desc' },
    });
  }

  private async notifyRecruiters(
    application: { CreatedBy: string; JobOfferId: string | null },
    actorEmployeeId: string,
    opts: { title: string; message: string; accent?: 'primary' | 'danger' | 'warning' | 'info' },
  ) {
    const ids = new Set<string>([application.CreatedBy]);
    if (application.JobOfferId) {
      const offer = await this.prisma.jobOffer.findUnique({
        where: { Id: application.JobOfferId },
        select: { CreatedBy: true },
      });
      if (offer) ids.add(offer.CreatedBy);
    }
    ids.delete(actorEmployeeId);
    for (const id of ids) {
      await this.notify.notifyRecruiter(id, { ...opts, href: '/hr/recruitment/contracts' });
    }
  }

  async generate(dto: GenerateContractDto, employeeId: string) {
    const app = await this.prisma.recruitmentApplication.findUnique({ where: { Id: dto.ApplicationId } });
    if (!app || app.IsDeleted) {
      throw new NotFoundException(`Candidature ${dto.ApplicationId} introuvable`);
    }
    const existing = await this.prisma.recruitmentContract.findFirst({
      where: { ApplicationId: dto.ApplicationId, IsDeleted: false },
    });
    if (existing) {
      throw new BadRequestException('Un contrat existe deja pour cette candidature');
    }
    let templateName: string | undefined;
    if (dto.TemplateId) {
      const tpl = await this.prisma.contractTemplate.findUnique({ where: { Id: dto.TemplateId } });
      if (!tpl || tpl.IsDeleted) {
        throw new NotFoundException(`Modele de contrat ${dto.TemplateId} introuvable`);
      }
      templateName = tpl.Name;
    }
    const row = await this.prisma.recruitmentContract.create({
      data: {
        ReferenceCode: await nextReferenceCode(REFERENCE_PREFIXES.contract, (p) =>
          this.prisma.recruitmentContract.count({ where: { ReferenceCode: { startsWith: p } } }),
        ),
        ApplicationId: dto.ApplicationId,
        TemplateId: dto.TemplateId,
        TemplateName: templateName,
        CandidateName: app.CandidateName,
        JobTitle: dto.JobTitle,
        EntityName: dto.EntityName,
        StartDate: new Date(dto.StartDate),
        EndDate: dto.EndDate ? new Date(dto.EndDate) : null,
        Salary: dto.Salary,
        Status: 'Draft',
        CreatedBy: employeeId,
      },
      include: INCLUDE,
    });
    this.notify.broadcast();
    return row;
  }

  async update(id: string, dto: UpdateContractDto, employeeId: string) {
    const existing = await this.findRaw(id);
    if (existing.Status !== 'Draft') {
      throw new BadRequestException('Seule une proposition en brouillon peut etre modifiee');
    }
    let templateName = existing.TemplateName;
    if (dto.TemplateId !== undefined && dto.TemplateId !== existing.TemplateId) {
      if (dto.TemplateId) {
        const tpl = await this.prisma.contractTemplate.findUnique({ where: { Id: dto.TemplateId } });
        if (!tpl || tpl.IsDeleted) {
          throw new NotFoundException(`Modele de contrat ${dto.TemplateId} introuvable`);
        }
        templateName = tpl.Name;
      } else {
        templateName = null;
      }
    }
    const row = await this.prisma.recruitmentContract.update({
      where: { Id: id },
      data: {
        TemplateId: dto.TemplateId !== undefined ? dto.TemplateId : existing.TemplateId,
        TemplateName: templateName,
        JobTitle: dto.JobTitle ?? existing.JobTitle,
        EntityName: dto.EntityName ?? existing.EntityName,
        StartDate: dto.StartDate ? new Date(dto.StartDate) : existing.StartDate,
        EndDate: dto.EndDate !== undefined ? (dto.EndDate ? new Date(dto.EndDate) : null) : existing.EndDate,
        Salary: dto.Salary ?? existing.Salary,
        ModifiedBy: employeeId,
        ModifiedAt: new Date(),
      },
      include: INCLUDE,
    });
    this.notify.broadcast();
    return row;
  }

  async send(id: string, employeeId: string) {
    const existing = await this.findRaw(id);
    if (!['Draft', 'Negotiating'].includes(existing.Status)) {
      throw new BadRequestException('Seule une proposition en brouillon ou en negociation peut etre (re)envoyee au candidat');
    }
    const row = await this.prisma.recruitmentContract.update({
      where: { Id: id },
      data: { Status: 'Sent', ModifiedBy: employeeId, ModifiedAt: new Date() },
      include: INCLUDE,
    });
    await this.notify.emailCandidate(existing.application.CandidateEmail, 'Proposition d\'embauche', {
      title: 'Proposition d\'embauche',
      bodyLines: [
        `Bonjour ${existing.application.CandidateName},`,
        `Nous avons le plaisir de vous adresser une proposition pour le poste de <strong>${existing.JobTitle}</strong>.`,
        'Notre equipe RH reviendra vers vous pour les modalites.',
      ],
    });
    await this.notifyRecruiters(existing.application, employeeId, {
      title: 'Proposition envoyee au candidat',
      message: `La proposition ${existing.ReferenceCode} (${existing.CandidateName}) a ete envoyee au candidat.`,
    });
    this.notify.broadcast();
    return row;
  }

  async negotiate(id: string, dto: NegotiateContractDto, employeeId: string) {
    const existing = await this.findRaw(id);
    if (!['Sent', 'Negotiating'].includes(existing.Status)) {
      throw new BadRequestException('La negociation ne peut porter que sur une proposition envoyee');
    }
    const lastRound = await this.prisma.contractNegotiationRound.findFirst({
      where: { ContractId: id },
      orderBy: { RoundNo: 'desc' },
    });
    const row = await this.prisma.$transaction(async (tx) => {
      await tx.contractNegotiationRound.create({
        data: {
          ContractId: id,
          RoundNo: (lastRound?.RoundNo ?? 0) + 1,
          FromParty: dto.FromParty,
          Amount: dto.Amount,
          Comment: dto.Comment,
        },
      });
      return tx.recruitmentContract.update({
        where: { Id: id },
        data: {
          Status: 'Negotiating',
          Salary: dto.FromParty === 'HR' && dto.Amount !== undefined ? dto.Amount : existing.Salary,
          ModifiedBy: employeeId,
          ModifiedAt: new Date(),
        },
        include: INCLUDE,
      });
    });
    await this.notifyRecruiters(existing.application, employeeId, {
      accent: 'warning',
      title: 'Negociation en cours',
      message: `Nouvel echange de negociation sur la proposition ${existing.ReferenceCode} (${existing.CandidateName}).`,
    });
    this.notify.broadcast();
    return row;
  }

  async accept(id: string, employeeId: string, dto?: AcceptContractDto) {
    const existing = await this.findRaw(id);
    if (!['Sent', 'Negotiating'].includes(existing.Status)) {
      throw new BadRequestException('Seule une proposition envoyee ou en negociation peut etre acceptee');
    }
    // Periode d'essai facultative : creee uniquement si le RH l'a demandee.
    const withTrial = dto?.WithTrial === true;
    const trialEnd = new Date(existing.StartDate);
    trialEnd.setMonth(trialEnd.getMonth() + TRIAL_PERIOD_MONTHS);

    const row = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.recruitmentContract.update({
        where: { Id: id },
        data: { Status: 'Accepted', RejectionReason: null, ModifiedBy: employeeId, ModifiedAt: new Date() },
        include: INCLUDE,
      });
      await tx.recruitmentApplication.update({
        where: { Id: existing.ApplicationId },
        data: { Status: 'Retained', ModifiedBy: employeeId, ModifiedAt: new Date() },
      });
      if (withTrial) {
        await tx.trialEmployee.create({
          data: {
            ReferenceCode: await nextReferenceCode(REFERENCE_PREFIXES.trial, (p) =>
              tx.trialEmployee.count({ where: { ReferenceCode: { startsWith: p } } }),
            ),
            ContractId: id,
            EmployeeName: existing.CandidateName,
            JobTitle: existing.JobTitle,
            EntityName: existing.EntityName,
            StartDate: existing.StartDate,
            TrialEndDate: trialEnd,
            Status: 'OnTrial',
            CreatedBy: employeeId,
          },
        });
      }
      return updated;
    });
    await this.notifyRecruiters(existing.application, employeeId, {
      title: 'Proposition acceptee',
      message: `${existing.CandidateName} a accepte la proposition ${existing.ReferenceCode}.${withTrial ? " Une periode d'essai a ete ouverte." : ''}`,
    });
    this.notify.broadcast();
    return row;
  }

  async refuse(id: string, dto: RefuseContractDto, employeeId: string) {
    const existing = await this.findRaw(id);
    if (!['Sent', 'Negotiating'].includes(existing.Status)) {
      throw new BadRequestException('Seule une proposition envoyee ou en negociation peut etre refusee');
    }
    const row = await this.prisma.recruitmentContract.update({
      where: { Id: id },
      data: { Status: 'Refused', RejectionReason: dto.RejectionReason, ModifiedBy: employeeId, ModifiedAt: new Date() },
      include: INCLUDE,
    });
    await this.notifyRecruiters(existing.application, employeeId, {
      accent: 'danger',
      title: 'Proposition refusee',
      message: `La proposition ${existing.ReferenceCode} (${existing.CandidateName}) a ete refusee : ${dto.RejectionReason}`,
    });
    this.notify.broadcast();
    return row;
  }

  async cancel(id: string, employeeId: string) {
    const existing = await this.findRaw(id);
    if (['Accepted', 'Cancelled'].includes(existing.Status)) {
      throw new BadRequestException(`Un contrat "${existing.Status}" ne peut plus etre annule`);
    }
    const row = await this.prisma.recruitmentContract.update({
      where: { Id: id },
      data: { Status: 'Cancelled', ModifiedBy: employeeId, ModifiedAt: new Date() },
      include: INCLUDE,
    });
    this.notify.broadcast();
    return row;
  }
}

import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { RecruitmentNotifyService } from '../recruitment-notify.service';
import { CreateEvalTemplateDto, UpdateEvalTemplateDto } from './dto/eval-template.dto';

const INCLUDE = {
  criteria: { orderBy: { Position: 'asc' as const } },
  _count: { select: { jobOffers: { where: { IsDeleted: false } } } },
} as const;

// Modeles de grille d'evaluation d'entretien — CRUD RH (US15). Rattachables
// a une offre (JobOffer.InterviewEvaluationTemplateId).
@Injectable()
export class EvalTemplateService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notify: RecruitmentNotifyService,
  ) {}

  private cleanCriteria(list: string[]): string[] {
    const cleaned = list.map((c) => c.trim()).filter(Boolean);
    if (cleaned.length === 0) {
      throw new BadRequestException('Une grille doit comporter au moins un critere');
    }
    return cleaned;
  }

  findAll() {
    return this.prisma.interviewEvaluationTemplate.findMany({
      where: { IsDeleted: false },
      include: INCLUDE,
      orderBy: { CreatedAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const row = await this.prisma.interviewEvaluationTemplate.findUnique({
      where: { Id: id },
      include: INCLUDE,
    });
    if (!row || row.IsDeleted) {
      throw new NotFoundException(`Grille d'evaluation ${id} introuvable`);
    }
    return row;
  }

  async create(dto: CreateEvalTemplateDto, employeeId: string) {
    const criteria = this.cleanCriteria(dto.Criteria);
    const row = await this.prisma.interviewEvaluationTemplate.create({
      data: {
        Name: dto.Name,
        CreatedBy: employeeId,
        criteria: { create: criteria.map((Label, Position) => ({ Label, Position })) },
      },
      include: INCLUDE,
    });
    this.notify.broadcast();
    return row;
  }

  async update(id: string, dto: UpdateEvalTemplateDto, employeeId: string) {
    await this.findOne(id);
    const data: { Name?: string; ModifiedBy: string; ModifiedAt: Date } = {
      ModifiedBy: employeeId,
      ModifiedAt: new Date(),
    };
    if (dto.Name !== undefined) data.Name = dto.Name;

    return this.prisma.$transaction(async (tx) => {
      if (dto.Criteria) {
        const criteria = this.cleanCriteria(dto.Criteria);
        await tx.interviewEvaluationCriterion.deleteMany({ where: { TemplateId: id } });
        await tx.interviewEvaluationCriterion.createMany({
          data: criteria.map((Label, Position) => ({ TemplateId: id, Label, Position })),
        });
      }
      const row = await tx.interviewEvaluationTemplate.update({
        where: { Id: id },
        data,
        include: INCLUDE,
      });
      this.notify.broadcast();
      return row;
    });
  }

  async remove(id: string, employeeId: string) {
    const row = await this.findOne(id);
    if (row._count.jobOffers > 0) {
      throw new BadRequestException(
        'Cette grille est rattachee a une ou plusieurs offres : detachez-la avant de la supprimer',
      );
    }
    await this.prisma.interviewEvaluationTemplate.update({
      where: { Id: id },
      data: { IsDeleted: true, DeletedBy: employeeId, DeletedAt: new Date() },
    });
    this.notify.broadcast();
    return { ok: true };
  }
}

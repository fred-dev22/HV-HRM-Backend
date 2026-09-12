import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { RecruitmentNotifyService } from '../recruitment-notify.service';
import { REFERENCE_PREFIXES } from '../recruitment.constants';
import { nextReferenceCode, joinTags } from '../recruitment.util';
import {
  CreateTalentPoolDto,
  UpdateTalentPoolDto,
  AddTalentPoolEvaluationDto,
} from './dto/talent-pool.dto';

const INCLUDE = {
  evaluations: { orderBy: { CreatedAt: 'desc' as const } },
  createdByEmployee: { select: { Id: true, FullName: true } },
} as const;

@Injectable()
export class TalentPoolService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notify: RecruitmentNotifyService,
  ) {}

  private async findRaw(id: string) {
    const row = await this.prisma.talentPoolEntry.findUnique({ where: { Id: id } });
    if (!row || row.IsDeleted) {
      throw new NotFoundException(`Entree du vivier ${id} introuvable`);
    }
    return row;
  }

  async findAll(q?: string) {
    const rows = await this.prisma.talentPoolEntry.findMany({
      where: { IsDeleted: false },
      include: INCLUDE,
      orderBy: { AddedAt: 'desc' },
    });
    if (!q?.trim()) return rows;
    const needle = q.trim().toLowerCase();
    return rows.filter(
      (r) =>
        r.CandidateName.toLowerCase().includes(needle) ||
        r.Tags.toLowerCase().includes(needle),
    );
  }

  async findOne(id: string) {
    const row = await this.prisma.talentPoolEntry.findUnique({ where: { Id: id }, include: INCLUDE });
    if (!row || row.IsDeleted) {
      throw new NotFoundException(`Entree du vivier ${id} introuvable`);
    }
    return row;
  }

  async create(dto: CreateTalentPoolDto, employeeId: string) {
    const row = await this.prisma.talentPoolEntry.create({
      data: {
        ReferenceCode: await nextReferenceCode(REFERENCE_PREFIXES.talentPool, (p) =>
          this.prisma.talentPoolEntry.count({ where: { ReferenceCode: { startsWith: p } } }),
        ),
        CandidateName: dto.CandidateName,
        CandidateEmail: dto.CandidateEmail,
        CandidatePhone: dto.CandidatePhone,
        Tags: joinTags(dto.Tags ?? []),
        Notes: dto.Notes ?? '',
        SourceApplicationId: dto.SourceApplicationId,
        AddedAt: new Date(),
        Status: 'Open',
        CreatedBy: employeeId,
      },
      include: INCLUDE,
    });
    this.notify.broadcast();
    return row;
  }

  async update(id: string, dto: UpdateTalentPoolDto, employeeId: string) {
    const existing = await this.findRaw(id);
    const row = await this.prisma.talentPoolEntry.update({
      where: { Id: id },
      data: {
        CandidateName: dto.CandidateName ?? existing.CandidateName,
        CandidateEmail: dto.CandidateEmail ?? existing.CandidateEmail,
        CandidatePhone: dto.CandidatePhone ?? existing.CandidatePhone,
        Tags: dto.Tags !== undefined ? joinTags(dto.Tags) : existing.Tags,
        Notes: dto.Notes !== undefined ? dto.Notes : existing.Notes,
        ModifiedBy: employeeId,
        ModifiedAt: new Date(),
      },
      include: INCLUDE,
    });
    this.notify.broadcast();
    return row;
  }

  async addEvaluation(id: string, dto: AddTalentPoolEvaluationDto, employeeId: string) {
    await this.findRaw(id);
    const author = await this.prisma.employee.findUnique({
      where: { Id: employeeId },
      select: { FullName: true },
    });
    await this.prisma.talentPoolEvaluation.create({
      data: {
        TalentPoolEntryId: id,
        Score: dto.Score,
        Comment: dto.Comment,
        EvaluatedByName: author?.FullName ?? 'RH',
      },
    });
    this.notify.broadcast();
    return this.findOne(id);
  }

  async setStatus(id: string, status: 'Open' | 'Closed', employeeId: string) {
    await this.findRaw(id);
    const row = await this.prisma.talentPoolEntry.update({
      where: { Id: id },
      data: { Status: status, ModifiedBy: employeeId, ModifiedAt: new Date() },
      include: INCLUDE,
    });
    this.notify.broadcast();
    return row;
  }

  async remove(id: string, employeeId: string) {
    await this.findRaw(id);
    await this.prisma.talentPoolEntry.update({
      where: { Id: id },
      data: { IsDeleted: true, DeletedBy: employeeId, DeletedAt: new Date() },
    });
    this.notify.broadcast();
    return { ok: true };
  }
}

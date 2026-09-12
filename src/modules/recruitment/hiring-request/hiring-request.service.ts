import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { RecruitmentNotifyService } from '../recruitment-notify.service';
import { REFERENCE_PREFIXES } from '../recruitment.constants';
import {
  nextReferenceCode,
  assertBesoinCanView,
  assertBesoinCanExpress,
  assertRecruitmentAccess,
} from '../recruitment.util';
import { CreateHiringRequestDto } from './dto/create-hiring-request.dto';
import { UpdateHiringRequestDto } from './dto/update-hiring-request.dto';

const INCLUDE = {
  createdByEmployee: { select: { Id: true, FullName: true } },
  jobOffers: { where: { IsDeleted: false }, select: { Id: true, ReferenceCode: true, Title: true, Status: true } },
} as const;

// Expression de besoin — exposee cote espace Administration (permissions
// RECRUTEMENT_BESOIN_*), et cote module pour le RH (RECRUTEMENT_ACCES).
// Aucun circuit de validation : Draft -> Open -> Closed | Cancelled.
@Injectable()
export class HiringRequestService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notify: RecruitmentNotifyService,
  ) {}

  private async findRaw(id: string) {
    const row = await this.prisma.hiringRequest.findUnique({ where: { Id: id } });
    if (!row || row.IsDeleted) {
      throw new NotFoundException(`Expression de besoin ${id} introuvable`);
    }
    return row;
  }

  private assertOwnerOrAccess(row: { CreatedBy: string }, employeeId: string, permissions: Set<string>) {
    if (row.CreatedBy === employeeId || permissions.has('RECRUTEMENT_ACCES')) return;
    throw new ForbiddenException("Vous ne pouvez agir que sur vos propres expressions de besoin");
  }

  async create(dto: CreateHiringRequestDto, employeeId: string, permissions: Set<string>) {
    assertBesoinCanExpress(permissions);
    const ReferenceCode = await nextReferenceCode(REFERENCE_PREFIXES.hiringRequest, (p) =>
      this.prisma.hiringRequest.count({ where: { ReferenceCode: { startsWith: p } } }),
    );
    const row = await this.prisma.hiringRequest.create({
      data: {
        ReferenceCode,
        PositionTitle: dto.PositionTitle,
        EntityName: dto.EntityName,
        Headcount: dto.Headcount,
        Profile: dto.Profile,
        Status: 'Draft',
        CreatedBy: employeeId,
      },
      include: INCLUDE,
    });
    this.notify.broadcast();
    return row;
  }

  async findAll(permissions: Set<string>) {
    assertBesoinCanView(permissions);
    return this.prisma.hiringRequest.findMany({
      where: { IsDeleted: false },
      include: INCLUDE,
      orderBy: { CreatedAt: 'desc' },
    });
  }

  async findOne(id: string, permissions: Set<string>) {
    assertBesoinCanView(permissions);
    const row = await this.prisma.hiringRequest.findUnique({ where: { Id: id }, include: INCLUDE });
    if (!row || row.IsDeleted) {
      throw new NotFoundException(`Expression de besoin ${id} introuvable`);
    }
    return row;
  }

  async update(id: string, dto: UpdateHiringRequestDto, employeeId: string, permissions: Set<string>) {
    assertBesoinCanExpress(permissions);
    const existing = await this.findRaw(id);
    this.assertOwnerOrAccess(existing, employeeId, permissions);
    if (existing.Status !== 'Draft') {
      throw new BadRequestException('Seule une expression de besoin en brouillon peut etre modifiee');
    }
    const row = await this.prisma.hiringRequest.update({
      where: { Id: id },
      data: {
        PositionTitle: dto.PositionTitle ?? existing.PositionTitle,
        EntityName: dto.EntityName ?? existing.EntityName,
        Headcount: dto.Headcount ?? existing.Headcount,
        Profile: dto.Profile ?? existing.Profile,
        ModifiedBy: employeeId,
        ModifiedAt: new Date(),
      },
      include: INCLUDE,
    });
    this.notify.broadcast();
    return row;
  }

  // "Exprimer" le besoin : Draft -> Open (visible du RH pour traitement).
  async submit(id: string, employeeId: string, permissions: Set<string>) {
    assertBesoinCanExpress(permissions);
    const existing = await this.findRaw(id);
    this.assertOwnerOrAccess(existing, employeeId, permissions);
    if (existing.Status !== 'Draft') {
      throw new BadRequestException('Cette expression de besoin a deja ete exprimee');
    }
    const row = await this.prisma.hiringRequest.update({
      where: { Id: id },
      data: { Status: 'Open', ModifiedBy: employeeId, ModifiedAt: new Date() },
      include: INCLUDE,
    });
    this.notify.broadcast();
    return row;
  }

  async close(id: string, employeeId: string, permissions: Set<string>) {
    assertRecruitmentAccess(permissions);
    const existing = await this.findRaw(id);
    if (existing.Status !== 'Open') {
      throw new BadRequestException('Seule une expression de besoin exprimee peut etre cloturee');
    }
    const row = await this.prisma.hiringRequest.update({
      where: { Id: id },
      data: { Status: 'Closed', ModifiedBy: employeeId, ModifiedAt: new Date() },
      include: INCLUDE,
    });
    this.notify.broadcast();
    return row;
  }

  async cancel(id: string, employeeId: string, permissions: Set<string>) {
    assertBesoinCanExpress(permissions);
    const existing = await this.findRaw(id);
    this.assertOwnerOrAccess(existing, employeeId, permissions);
    if (existing.Status === 'Closed' || existing.Status === 'Cancelled') {
      throw new BadRequestException(`Une expression de besoin "${existing.Status}" ne peut plus etre annulee`);
    }
    const row = await this.prisma.hiringRequest.update({
      where: { Id: id },
      data: { Status: 'Cancelled', ModifiedBy: employeeId, ModifiedAt: new Date() },
      include: INCLUDE,
    });
    this.notify.broadcast();
    return row;
  }

  async remove(id: string, employeeId: string, permissions: Set<string>) {
    assertBesoinCanExpress(permissions);
    const existing = await this.findRaw(id);
    this.assertOwnerOrAccess(existing, employeeId, permissions);
    if (existing.Status !== 'Draft' && existing.Status !== 'Cancelled') {
      throw new BadRequestException('Seul un brouillon ou une demande annulee peut etre supprime');
    }
    await this.prisma.hiringRequest.update({
      where: { Id: id },
      data: { IsDeleted: true, DeletedBy: employeeId, DeletedAt: new Date() },
    });
    this.notify.broadcast();
    return { ok: true };
  }
}

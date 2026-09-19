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
  // Sieges du poste choisi (occupes = employes titulaires non supprimes,
  // jamais stocke, meme regle que PositionService.occupiedCount) — voir shape().
  position: { select: { Code: true, Capacity: true, _count: { select: { employees: { where: { IsDeleted: false } } } } } },
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

  // Signal (jamais un blocage) : effectif demande superieur aux places restantes
  // du poste choisi. Recalcule a chaque lecture depuis l'occupation reelle du
  // poste, donc il disparait tout seul quand une place se libere ; limite aux
  // demandes encore actives (brouillon / exprimee), sans objet une fois
  // cloturee ou annulee.
  private shape<
    T extends {
      Status: string;
      Headcount: number;
      position: { Code: string; Capacity: number; _count: { employees: number } } | null;
    },
  >(row: T) {
    const { position, ...rest } = row;
    const capacity = position ? position.Capacity : null;
    const occupied = position ? position._count.employees : null;
    const available = capacity !== null && occupied !== null ? Math.max(0, capacity - occupied) : null;
    const active = row.Status === 'Draft' || row.Status === 'Open';
    return {
      ...rest,
      PositionCode: position?.Code ?? null,
      PositionCapacity: capacity,
      PositionOccupiedCount: occupied,
      PositionAvailable: available,
      CapacityWarning: active && available !== null && row.Headcount > available,
    };
  }

  private async assertPositionExists(positionId: string) {
    const position = await this.prisma.position.findUnique({ where: { Id: positionId }, select: { Id: true } });
    if (!position) throw new BadRequestException(`Poste ${positionId} introuvable`);
  }

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
    if (dto.PositionId) await this.assertPositionExists(dto.PositionId);
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
        PositionId: dto.PositionId ?? null,
        Status: 'Draft',
        CreatedBy: employeeId,
      },
      include: INCLUDE,
    });
    this.notify.broadcast();
    return this.shape(row);
  }

  async findAll(permissions: Set<string>) {
    assertBesoinCanView(permissions);
    const rows = await this.prisma.hiringRequest.findMany({
      where: { IsDeleted: false },
      include: INCLUDE,
      orderBy: { CreatedAt: 'desc' },
    });
    return rows.map((r) => this.shape(r));
  }

  async findOne(id: string, permissions: Set<string>) {
    assertBesoinCanView(permissions);
    const row = await this.prisma.hiringRequest.findUnique({ where: { Id: id }, include: INCLUDE });
    if (!row || row.IsDeleted) {
      throw new NotFoundException(`Expression de besoin ${id} introuvable`);
    }
    return this.shape(row);
  }

  async update(id: string, dto: UpdateHiringRequestDto, employeeId: string, permissions: Set<string>) {
    assertBesoinCanExpress(permissions);
    const existing = await this.findRaw(id);
    this.assertOwnerOrAccess(existing, employeeId, permissions);
    if (existing.Status !== 'Draft') {
      throw new BadRequestException('Seule une expression de besoin en brouillon peut etre modifiee');
    }
    if (dto.PositionId) await this.assertPositionExists(dto.PositionId);
    const row = await this.prisma.hiringRequest.update({
      where: { Id: id },
      data: {
        PositionTitle: dto.PositionTitle ?? existing.PositionTitle,
        EntityName: dto.EntityName ?? existing.EntityName,
        Headcount: dto.Headcount ?? existing.Headcount,
        Profile: dto.Profile ?? existing.Profile,
        PositionId: dto.PositionId === undefined ? existing.PositionId : dto.PositionId,
        ModifiedBy: employeeId,
        ModifiedAt: new Date(),
      },
      include: INCLUDE,
    });
    this.notify.broadcast();
    return this.shape(row);
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
    return this.shape(row);
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
    return this.shape(row);
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
    return this.shape(row);
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

import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { CreateTimeSiteDto, UpdateTimeSiteDto } from './time-sites.dto';

const NOT_REMOVED = { IsDeleted: false, IsSystem: false };

// Sites de travail et minutes de trajet et de changement deduites de la presence
// de leurs employes (a l'arrivee et au depart).
@Injectable()
export class TimeSitesService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll() {
    const [sites, counts, withoutSite] = await Promise.all([
      this.prisma.timeSite.findMany({ orderBy: { Name: 'asc' } }),
      this.prisma.employee.groupBy({
        by: ['TimeSiteId'],
        where: { ...NOT_REMOVED, Status: { not: 'Inactive' }, TimeSiteId: { not: null } },
        _count: { _all: true },
      }),
      // Les cadres ne sont pas concernes.
      this.prisma.employee.count({ where: { ...NOT_REMOVED, Status: { not: 'Inactive' }, IsCadre: false, TimeSiteId: null } }),
    ]);
    return {
      Sites: sites.map((s) => ({
        Id: s.Id,
        Code: s.Code,
        Name: s.Name,
        DeductionMinutes: s.DeductionMinutes,
        EmployeeCount: counts.find((c) => c.TimeSiteId === s.Id)?._count._all ?? 0,
      })),
      NonCadresWithoutSite: withoutSite,
    };
  }

  // Employes proposes au rattachement.
  async employees() {
    const rows = await this.prisma.employee.findMany({
      where: { ...NOT_REMOVED, Status: { not: 'Inactive' } },
      select: {
        Id: true, FullName: true, EmployeeNumber: true, IsCadre: true, TimeSiteId: true,
        organizationUnit: { select: { Name: true } },
      },
      orderBy: [{ FullName: 'asc' }, { Id: 'asc' }],
    });
    return rows.map((e) => ({
      Id: e.Id,
      FullName: e.FullName,
      EmployeeNumber: e.EmployeeNumber,
      IsCadre: e.IsCadre,
      TimeSiteId: e.TimeSiteId,
      EntityName: e.organizationUnit?.Name ?? null,
    }));
  }

  private async assertUnique(code: string | undefined, name: string | undefined, exceptId?: string) {
    const clash = await this.prisma.timeSite.findFirst({
      where: {
        ...(exceptId ? { Id: { not: exceptId } } : {}),
        OR: [...(code ? [{ Code: code }] : []), ...(name ? [{ Name: name }] : [])],
      },
    });
    if (clash && (code || name)) throw new ConflictException('Un site porte déjà ce code ou ce nom');
  }

  private async findOrFail(id: string) {
    const site = await this.prisma.timeSite.findUnique({ where: { Id: id } });
    if (!site) throw new NotFoundException('Site introuvable');
    return site;
  }

  async create(dto: CreateTimeSiteDto) {
    const code = dto.Code.trim().toUpperCase();
    const name = dto.Name.trim();
    await this.assertUnique(code, name);
    return this.prisma.timeSite.create({ data: { Code: code, Name: name, DeductionMinutes: dto.DeductionMinutes } });
  }

  async update(id: string, dto: UpdateTimeSiteDto) {
    await this.findOrFail(id);
    const code = dto.Code?.trim().toUpperCase();
    const name = dto.Name?.trim();
    await this.assertUnique(code, name, id);
    return this.prisma.timeSite.update({ where: { Id: id }, data: { Code: code, Name: name, DeductionMinutes: dto.DeductionMinutes } });
  }

  async remove(id: string) {
    await this.findOrFail(id);
    const attached = await this.prisma.employee.count({ where: { TimeSiteId: id, IsDeleted: false } });
    if (attached > 0) {
      throw new ConflictException(`${attached} employé(s) sont rattachés à ce site : rattachez-les ailleurs avant de le supprimer`);
    }
    await this.prisma.$transaction([
      // Les fiches supprimees ne bloquent pas la suppression du site.
      this.prisma.employee.updateMany({ where: { TimeSiteId: id }, data: { TimeSiteId: null } }),
      this.prisma.timeSite.delete({ where: { Id: id } }),
    ]);
  }

  // La liste envoyee devient la liste exacte des employes du site : ceux qui n'y
  // figurent plus sont detaches, ceux d'un autre site sont deplaces.
  async setEmployees(id: string, employeeIds: string[]) {
    await this.findOrFail(id);
    const ids = [...new Set(employeeIds)];
    await this.prisma.$transaction([
      this.prisma.employee.updateMany({ where: { TimeSiteId: id, IsDeleted: false, Id: { notIn: ids } }, data: { TimeSiteId: null } }),
      this.prisma.employee.updateMany({ where: { Id: { in: ids }, ...NOT_REMOVED }, data: { TimeSiteId: id } }),
    ]);
    return this.findAll();
  }
}

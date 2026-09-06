import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateOrganizationUnitDto } from './dto/create-organization-unit.dto';
import { UpdateOrganizationUnitDto } from './dto/update-organization-unit.dto';
import { bulkImport } from '../../common/utils/bulk-import.util';

@Injectable()
export class OrganizationUnitService {
  constructor(private readonly prisma: PrismaService) {}

  create(dto: CreateOrganizationUnitDto, createdBy: string) {
    return this.prisma.organizationUnit.create({ data: { ...dto, CreatedBy: createdBy } });
  }

  // Import CSV (Lot D) — voir common/utils/bulk-import.util.ts. L'entite
  // parente (ParentId) doit deja exister : pas de tri topologique ici, le
  // frontend ne resout que par rapport aux entites deja chargees avant
  // l'ouverture de l'import (voir message de dependance affiche a l'etape 1).
  bulkCreate(items: unknown[], createdBy: string) {
    return bulkImport(items, CreateOrganizationUnitDto, (dto) => this.create(dto, createdBy));
  }

  findAll() {
    return this.prisma.organizationUnit.findMany({ where: { IsDeleted: false } });
  }

  async findTree() {
    const units = await this.prisma.organizationUnit.findMany({ where: { IsDeleted: false } });
    const byParent = new Map<string | null, typeof units>();
    for (const unit of units) {
      const key = unit.ParentId;
      const bucket = byParent.get(key);
      if (bucket) bucket.push(unit);
      else byParent.set(key, [unit]);
    }

    const buildNode = (unit: (typeof units)[number]) => ({
      ...unit,
      children: (byParent.get(unit.Id) ?? []).map(buildNode),
    });

    return (byParent.get(null) ?? []).map(buildNode);
  }

  findChildren(id: string) {
    return this.prisma.organizationUnit.findMany({ where: { ParentId: id, IsDeleted: false } });
  }

  async findOne(id: string) {
    const unit = await this.prisma.organizationUnit.findUnique({ where: { Id: id } });
    if (!unit || unit.IsDeleted) {
      throw new NotFoundException(`Unité organisationnelle ${id} introuvable`);
    }
    return unit;
  }

  async update(id: string, dto: UpdateOrganizationUnitDto, modifiedBy: string) {
    const unit = await this.findOne(id);
    // L'entite racine (Direction Generale, creee au seed, sans parent) ne
    // peut jamais etre desactivee — c'est la racine de tout l'organigramme,
    // la desactiver casserait irremediablement la structure de l'entreprise.
    // Le frontend deja masque le bouton, ceci est le filet de securite cote
    // serveur si l'API est appelee directement.
    if (dto.Status === 'Inactive' && unit.ParentId === null) {
      throw new BadRequestException("L'entité racine de l'organigramme ne peut pas être désactivée");
    }
    const data: UpdateOrganizationUnitDto & { ModifiedBy: string; ModifiedAt: Date; Status?: string } = {
      ...dto,
      ModifiedBy: modifiedBy,
      ModifiedAt: new Date(),
    };
    // Plan de tests #23 : une entite deja approuvee (Active) restait
    // modifiable sans repasser par la validation. Un edit de contenu (aucun
    // Status explicite dans le payload — distinct de Desactiver/Reactiver,
    // qui envoient toujours Status) sur une entite Active la repasse en
    // attente d'approbation. L'entite racine y echappe, meme exception que
    // pour la desactivation ci-dessus : elle reste toujours active.
    if (dto.Status === undefined && unit.Status === 'Active' && unit.ParentId !== null) {
      data.Status = 'PendingApproval';
    }
    return this.prisma.organizationUnit.update({
      where: { Id: id },
      data,
    });
  }

  // Suppression definitive (Lot I) — cache l'entite de tout l'app
  // (IsDeleted:false deja applique dans findAll/findTree/findChildren/
  // findOne) sans casser les references historiques. Bloque si l'entite a
  // encore des enfants ou des employes actifs, sans quoi ils pointeraient
  // vers une entite devenue invisible partout. (Un ancien remove() faisait
  // un hard delete via DELETE /:id sous ENTITE_DESACTIVER — supprime : mort
  // cote frontend, qui ne PATCHe que Status pour desactiver/reactiver.)
  async softDelete(id: string, deletedBy: string) {
    const unit = await this.findOne(id);
    if (unit.ParentId === null) {
      throw new BadRequestException("L'entité racine de l'organigramme ne peut pas être supprimée");
    }
    const [childCount, employeeCount] = await Promise.all([
      this.prisma.organizationUnit.count({ where: { ParentId: id, IsDeleted: false } }),
      this.prisma.employee.count({ where: { OrganizationUnitId: id, IsDeleted: false } }),
    ]);
    if (childCount > 0) {
      throw new BadRequestException(
        `Cette entité a encore ${childCount} sous-entité(s) — déplacez-les ou supprimez-les d'abord`,
      );
    }
    if (employeeCount > 0) {
      throw new BadRequestException(
        `Cette entité a encore ${employeeCount} employé(s) rattaché(s) — réaffectez-les d'abord`,
      );
    }
    return this.prisma.organizationUnit.update({
      where: { Id: id },
      data: { IsDeleted: true, DeletedBy: deletedBy, DeletedAt: new Date() },
    });
  }

  async submit(id: string, modifiedBy: string) {
    const unit = await this.findOne(id);
    if (unit.Status !== 'Draft') {
      throw new ConflictException(
        'Seule une unité en brouillon peut être soumise pour approbation',
      );
    }
    return this.prisma.organizationUnit.update({
      where: { Id: id },
      data: { Status: 'PendingApproval', ModifiedBy: modifiedBy, ModifiedAt: new Date() },
    });
  }

  async approve(id: string, modifiedBy: string) {
    const unit = await this.findOne(id);
    if (unit.Status !== 'PendingApproval') {
      throw new ConflictException(
        "Seule une unité en attente d'approbation peut être approuvée",
      );
    }
    return this.prisma.organizationUnit.update({
      where: { Id: id },
      data: { Status: 'Active', ModifiedBy: modifiedBy, ModifiedAt: new Date() },
    });
  }

  async reject(id: string, modifiedBy: string) {
    const unit = await this.findOne(id);
    if (unit.Status !== 'PendingApproval') {
      throw new ConflictException(
        "Seule une unité en attente d'approbation peut être rejetée",
      );
    }
    return this.prisma.organizationUnit.update({
      where: { Id: id },
      data: { Status: 'Draft', ModifiedBy: modifiedBy, ModifiedAt: new Date() },
    });
  }
}

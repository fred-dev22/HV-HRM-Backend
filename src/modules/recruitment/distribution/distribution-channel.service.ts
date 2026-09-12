import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { DistributionChannel } from '../../../../prisma/generated/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { RecruitmentNotifyService } from '../recruitment-notify.service';
import { CreateDistributionChannelDto, UpdateDistributionChannelDto } from './dto/distribution.dto';
import { DistributionDispatchService } from './distribution-dispatch.service';
import { isAllowedWebhookUrl } from './webhook-url.util';

// CRUD des canaux de diffusion. Le Secret n'est JAMAIS serialise : la reponse
// ne porte qu'un booleen hasSecret.
@Injectable()
export class DistributionChannelService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notify: RecruitmentNotifyService,
    private readonly dispatch: DistributionDispatchService,
  ) {}

  private shape(c: DistributionChannel) {
    return {
      id: c.Id,
      name: c.Name,
      kind: c.Kind,
      targetUrl: c.TargetUrl,
      targetEmail: c.TargetEmail,
      hasSecret: !!c.Secret,
      isActive: c.IsActive,
      createdAt: c.CreatedAt,
      createdBy: c.CreatedBy,
      modifiedAt: c.ModifiedAt,
    };
  }

  private async findRaw(id: string): Promise<DistributionChannel> {
    const row = await this.prisma.distributionChannel.findUnique({ where: { Id: id } });
    if (!row || row.IsDeleted) {
      throw new NotFoundException(`Canal de diffusion ${id} introuvable`);
    }
    return row;
  }

  async findAll() {
    const rows = await this.prisma.distributionChannel.findMany({
      where: { IsDeleted: false },
      orderBy: { CreatedAt: 'desc' },
    });
    return rows.map((r) => this.shape(r));
  }

  async findOne(id: string) {
    return this.shape(await this.findRaw(id));
  }

  async create(dto: CreateDistributionChannelDto, employeeId: string) {
    if (dto.Kind === 'Webhook' && !isAllowedWebhookUrl(dto.TargetUrl)) {
      throw new BadRequestException('URL de webhook non autorisee');
    }
    const row = await this.prisma.distributionChannel.create({
      data: {
        Name: dto.Name,
        Kind: dto.Kind,
        TargetUrl: dto.Kind === 'Webhook' ? dto.TargetUrl ?? null : null,
        TargetEmail: dto.Kind === 'Email' ? dto.TargetEmail ?? null : null,
        Secret: dto.Secret ? dto.Secret : null,
        IsActive: dto.IsActive ?? true,
        CreatedBy: employeeId,
      },
    });
    this.notify.broadcast();
    return this.shape(row);
  }

  async update(id: string, dto: UpdateDistributionChannelDto, employeeId: string) {
    const existing = await this.findRaw(id);
    const nextKind = dto.Kind ?? existing.Kind;
    const nextTargetUrl = dto.TargetUrl !== undefined ? dto.TargetUrl ?? null : existing.TargetUrl;
    const nextTargetEmail = dto.TargetEmail !== undefined ? dto.TargetEmail ?? null : existing.TargetEmail;

    if (nextKind === 'Webhook' && !isAllowedWebhookUrl(nextTargetUrl)) {
      throw new BadRequestException('URL de webhook non autorisee');
    }

    // Secret : '' efface, absent laisse inchange, sinon remplace.
    const secretPatch: { Secret?: string | null } =
      dto.Secret !== undefined ? { Secret: dto.Secret === '' ? null : dto.Secret } : {};

    const row = await this.prisma.distributionChannel.update({
      where: { Id: id },
      data: {
        Name: dto.Name ?? existing.Name,
        Kind: nextKind,
        TargetUrl: nextKind === 'Webhook' ? nextTargetUrl : null,
        TargetEmail: nextKind === 'Email' ? nextTargetEmail : null,
        ...secretPatch,
        IsActive: dto.IsActive ?? existing.IsActive,
        ModifiedBy: employeeId,
        ModifiedAt: new Date(),
      },
    });
    this.notify.broadcast();
    return this.shape(row);
  }

  async remove(id: string, employeeId: string) {
    await this.findRaw(id);
    // Soft delete : les lignes JobOfferDistribution gardent leurs instantanes
    // ChannelName / ChannelKind, l'historique reste lisible.
    await this.prisma.distributionChannel.update({
      where: { Id: id },
      data: { IsDeleted: true, DeletedBy: employeeId, DeletedAt: new Date(), IsActive: false },
    });
    this.notify.broadcast();
    return { ok: true };
  }

  // Envoie un webhook synthetique pour valider un relais Zapier/Make/n8n.
  // N'ecrit aucune ligne de suivi.
  test(id: string) {
    return this.dispatch.testChannel(id);
  }
}

import { Injectable, NotFoundException } from '@nestjs/common';
import type { JobOffer } from '../../../../prisma/generated/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { RecruitmentNotifyService } from '../recruitment-notify.service';
import { frontendOrigin } from '../../mail/email-templates';
import { buildShareContent } from './share-content.util';
import { UpdateJobOfferDistributionDto } from './dto/distribution.dto';
import { DistributionDispatchService } from './distribution-dispatch.service';

const CHANNEL_SELECT = {
  channel: { select: { Id: true, Name: true, Kind: true, IsActive: true, IsDeleted: true } },
} as const;

interface DistRow {
  Id: string;
  JobOfferId: string;
  ChannelId: string;
  ChannelName: string;
  ChannelKind: string;
  Status: string;
  Trigger: string;
  ExternalUrl: string | null;
  Attempts: number;
  HttpStatus: number | null;
  ResponseSnippet: string | null;
  LastAttemptAt: Date | null;
  PostedAt: Date | null;
  CreatedAt: Date;
  ModifiedAt: Date | null;
  channel?: { Id: string; Name: string; Kind: string; IsActive: boolean; IsDeleted: boolean } | null;
}

// Suivi de diffusion par offre + contenu pret a coller. Le fan-out reel est
// delegue a DistributionDispatchService.
@Injectable()
export class JobOfferDistributionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notify: RecruitmentNotifyService,
    private readonly dispatch: DistributionDispatchService,
  ) {}

  private async loadOffer(id: string): Promise<JobOffer> {
    const offer = await this.prisma.jobOffer.findUnique({ where: { Id: id } });
    if (!offer || offer.IsDeleted) {
      throw new NotFoundException(`Offre ${id} introuvable`);
    }
    return offer;
  }

  private shape(r: DistRow) {
    return {
      id: r.Id,
      jobOfferId: r.JobOfferId,
      channelId: r.ChannelId,
      channelName: r.ChannelName,
      channelKind: r.ChannelKind,
      status: r.Status,
      trigger: r.Trigger,
      externalUrl: r.ExternalUrl,
      attempts: r.Attempts,
      httpStatus: r.HttpStatus,
      responseSnippet: r.ResponseSnippet,
      lastAttemptAt: r.LastAttemptAt,
      postedAt: r.PostedAt,
      createdAt: r.CreatedAt,
      modifiedAt: r.ModifiedAt,
      channelIsActive: r.channel ? r.channel.IsActive && !r.channel.IsDeleted : false,
    };
  }

  async list(offerId: string) {
    await this.loadOffer(offerId);
    const rows = await this.prisma.jobOfferDistribution.findMany({
      where: { JobOfferId: offerId },
      orderBy: { CreatedAt: 'desc' },
      include: CHANNEL_SELECT,
    });
    return rows.map((r) => this.shape(r as DistRow));
  }

  async shareContent(offerId: string) {
    const offer = await this.loadOffer(offerId);
    const publicUrl = `${frontendOrigin().replace(/\/+$/, '')}/careers/${offer.PublicToken}`;
    return buildShareContent(offer, publicUrl);
  }

  async patch(offerId: string, distId: string, dto: UpdateJobOfferDistributionDto, employeeId: string) {
    await this.loadOffer(offerId);
    const row = await this.prisma.jobOfferDistribution.findUnique({ where: { Id: distId } });
    if (!row || row.JobOfferId !== offerId) {
      throw new NotFoundException(`Diffusion ${distId} introuvable pour cette offre`);
    }

    const hasUrl = dto.ExternalUrl !== undefined && dto.ExternalUrl !== '';
    const wantsPosted = dto.Status === 'Posted' || (hasUrl && dto.Status === undefined);

    const data: Record<string, unknown> = { ModifiedBy: employeeId, ModifiedAt: new Date() };
    if (dto.Status !== undefined) data.Status = dto.Status;
    if (dto.ExternalUrl !== undefined) data.ExternalUrl = dto.ExternalUrl === '' ? null : dto.ExternalUrl;
    if (wantsPosted) {
      data.Status = 'Posted';
      if (!row.PostedAt) data.PostedAt = new Date();
    }

    const updated = await this.prisma.jobOfferDistribution.update({
      where: { Id: distId },
      data,
      include: CHANNEL_SELECT,
    });
    this.notify.broadcast();
    return this.shape(updated as DistRow);
  }

  async retry(offerId: string, distId: string) {
    await this.loadOffer(offerId);
    await this.dispatch.retryOne(offerId, distId);
    this.notify.broadcast();
    const row = await this.prisma.jobOfferDistribution.findUnique({
      where: { Id: distId },
      include: CHANNEL_SELECT,
    });
    return this.shape(row as DistRow);
  }
}

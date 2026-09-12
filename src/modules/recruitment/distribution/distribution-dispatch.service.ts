import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { DistributionChannel, JobOffer, JobOfferDistribution } from '../../../../prisma/generated/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { MailService } from '../../mail/mail.service';
import { frontendOrigin, renderEmailHtml } from '../../mail/email-templates';
import { CLIENT_SHORT_NAME, FEED_DESCRIPTION_MAX, WEBHOOK_TIMEOUT_MS } from '../recruitment.constants';
import { resolvePortalAuthorId } from '../recruitment.util';
import { capFeedText } from './job-feed.util';
import { buildShareContent } from './share-content.util';
import { isAllowedWebhookUrl, signBody } from './webhook-url.util';

export type DistributionTrigger = 'Publish' | 'Close' | 'Manual';

interface WebhookResult {
  httpStatus: number | null;
  ok: boolean;
  snippet: string | null;
  externalUrl: string | null;
}

// Corps de webhook lu au maximum sur 2 Ko (protege contre une reponse
// volumineuse d'un endpoint distant mal concu).
const RESPONSE_BODY_CAP = 2048;
const SNIPPET_CAP = 500;

// Fan-out d'une offre vers les canaux de diffusion actifs. Appele en
// fire-and-forget depuis JobOfferService.publish()/close() : dispatchForOffer
// NE LEVE JAMAIS. Les points d'entree explicites (retryOne, testChannel)
// peuvent lever des 400/404 de validation, mais l'appel reseau lui-meme est
// toujours encapsule.
@Injectable()
export class DistributionDispatchService {
  private readonly logger = new Logger(DistributionDispatchService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
  ) {}

  private publicUrl(token: string): string {
    return `${frontendOrigin().replace(/\/+$/, '')}/careers/${token}`;
  }

  private eventName(trigger: DistributionTrigger): string {
    return trigger === 'Close' ? 'joboffer.closed' : 'joboffer.published';
  }

  private buildOfferPayload(offer: JobOffer, trigger: DistributionTrigger): unknown {
    return {
      event: this.eventName(trigger),
      trigger,
      triggeredAt: new Date().toISOString(),
      offer: {
        token: offer.PublicToken,
        referenceNumber: offer.ReferenceCode,
        title: offer.Title,
        entityName: offer.EntityName,
        contractType: offer.ContractType,
        location: offer.Location,
        salaryText: offer.SalaryText ?? null,
        description: capFeedText(offer.Description, FEED_DESCRIPTION_MAX),
        publicUrl: this.publicUrl(offer.PublicToken),
        publishedAt: offer.PublishedAt ? offer.PublishedAt.toISOString() : null,
        status: offer.Status,
      },
    };
  }

  private async readCapped(res: Response): Promise<string> {
    try {
      const buf = await res.arrayBuffer();
      return Buffer.from(buf).subarray(0, RESPONSE_BODY_CAP).toString('utf8');
    } catch {
      return '';
    }
  }

  private async performWebhook(
    url: string,
    payload: unknown,
    secret: string | null,
    eventName: string,
  ): Promise<WebhookResult> {
    const body = JSON.stringify(payload);
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'User-Agent': 'Productive247-HRM-Webhook/1.0',
      'X-Productive247-Event': eventName,
    };
    if (secret) headers['X-Productive247-Signature'] = signBody(secret, body);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body,
        redirect: 'error',
        signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
      });
      const raw = await this.readCapped(res);
      const snippet = raw.trim() ? raw.slice(0, SNIPPET_CAP) : null;
      let externalUrl: string | null = null;
      try {
        const parsed = JSON.parse(raw) as { url?: unknown };
        if (parsed && typeof parsed.url === 'string' && /^https?:\/\//i.test(parsed.url)) {
          externalUrl = parsed.url.slice(0, 500);
        }
      } catch {
        /* reponse non JSON : pas d'URL a extraire */
      }
      return {
        httpStatus: res.status,
        ok: res.status >= 200 && res.status < 300,
        snippet,
        externalUrl,
      };
    } catch (err) {
      const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
      return { httpStatus: null, ok: false, snippet: msg.slice(0, SNIPPET_CAP), externalUrl: null };
    }
  }

  // ---- Fire-and-forget : publish() / close() -----------------------------

  async dispatchForOffer(offerId: string, trigger: DistributionTrigger): Promise<void> {
    try {
      const offer = await this.prisma.jobOffer.findUnique({ where: { Id: offerId } });
      if (!offer || offer.IsDeleted) return;
      // Offre exclue des flux publics (poste confidentiel) : ne pousse vers
      // aucun canal (webhook/email) non plus, comme annonce par la case a
      // cocher cote front ("... ni les webhooks"). Sans ce garde-fou, seul
      // feed.json/feed.xml respectait l'exclusion (voir JobFeedService) et
      // l'offre partait quand meme vers les webhooks actifs.
      if (offer.ExcludeFromFeed) return;
      const channels = await this.prisma.distributionChannel.findMany({
        where: { IsActive: true, IsDeleted: false },
      });
      if (!channels.length) return;
      const actorId = await resolvePortalAuthorId(this.prisma);
      for (const channel of channels) {
        try {
          await this.dispatchOne(offer, channel, trigger, actorId);
        } catch (err) {
          this.logger.error(
            `Diffusion offre ${offerId} vers canal ${channel.Id} echouee`,
            err instanceof Error ? err.stack : String(err),
          );
        }
      }
    } catch (err) {
      this.logger.error(
        `Diffusion de l'offre ${offerId} interrompue`,
        err instanceof Error ? err.stack : String(err),
      );
    }
  }

  private async ensureRow(
    offer: JobOffer,
    channel: DistributionChannel,
    trigger: DistributionTrigger,
    actorId: string,
  ): Promise<JobOfferDistribution | null> {
    const key = { JobOfferId_ChannelId: { JobOfferId: offer.Id, ChannelId: channel.Id } };
    const found = await this.prisma.jobOfferDistribution.findUnique({ where: key });
    if (found) return found;
    try {
      return await this.prisma.jobOfferDistribution.create({
        data: {
          JobOfferId: offer.Id,
          ChannelId: channel.Id,
          ChannelName: channel.Name,
          ChannelKind: channel.Kind,
          Status: 'Pending',
          Trigger: trigger,
          CreatedBy: actorId,
        },
      });
    } catch (err) {
      if ((err as { code?: string }).code === 'P2002') {
        return this.prisma.jobOfferDistribution.findUnique({ where: key });
      }
      throw err;
    }
  }

  private async dispatchOne(
    offer: JobOffer,
    channel: DistributionChannel,
    trigger: DistributionTrigger,
    actorId: string,
  ): Promise<void> {
    const row = await this.ensureRow(offer, channel, trigger, actorId);
    if (!row) return;

    if (channel.Kind === 'Webhook') {
      await this.sendWebhookForRow(row.Id, offer, channel, trigger, actorId);
      return;
    }
    if (channel.Kind === 'Email') {
      await this.sendEmailForRow(row.Id, offer, channel, trigger, actorId);
      return;
    }
    // RssOnly : rien a pousser, l'offre est deja dans feed.xml -> Skipped.
    // Manual : le RH publiera puis collera l'URL -> Pending (sauf deja Posted).
    await this.prisma.jobOfferDistribution.update({
      where: { Id: row.Id },
      data: {
        Trigger: trigger,
        Status: row.Status === 'Posted' ? 'Posted' : channel.Kind === 'RssOnly' ? 'Skipped' : 'Pending',
        ChannelName: channel.Name,
        ChannelKind: channel.Kind,
        ModifiedBy: actorId,
        ModifiedAt: new Date(),
      },
    });
  }

  private async sendWebhookForRow(
    rowId: string,
    offer: JobOffer,
    channel: DistributionChannel,
    trigger: DistributionTrigger,
    actorId: string,
  ): Promise<JobOfferDistribution> {
    const url = channel.TargetUrl;
    if (!url || !isAllowedWebhookUrl(url)) {
      return this.prisma.jobOfferDistribution.update({
        where: { Id: rowId },
        data: {
          Status: 'Failed',
          Trigger: trigger,
          Attempts: { increment: 1 },
          HttpStatus: null,
          ResponseSnippet: 'URL de webhook non autorisee ou absente',
          LastAttemptAt: new Date(),
          ChannelName: channel.Name,
          ChannelKind: channel.Kind,
          ModifiedBy: actorId,
          ModifiedAt: new Date(),
        },
      });
    }
    const result = await this.performWebhook(
      url,
      this.buildOfferPayload(offer, trigger),
      channel.Secret ?? null,
      this.eventName(trigger),
    );
    return this.prisma.jobOfferDistribution.update({
      where: { Id: rowId },
      data: {
        Status: result.ok ? 'Sent' : 'Failed',
        Trigger: trigger,
        Attempts: { increment: 1 },
        HttpStatus: result.httpStatus,
        ResponseSnippet: result.snippet,
        LastAttemptAt: new Date(),
        ...(result.externalUrl ? { ExternalUrl: result.externalUrl } : {}),
        ChannelName: channel.Name,
        ChannelKind: channel.Kind,
        ModifiedBy: actorId,
        ModifiedAt: new Date(),
      },
    });
  }

  private async sendEmailForRow(
    rowId: string,
    offer: JobOffer,
    channel: DistributionChannel,
    trigger: DistributionTrigger,
    actorId: string,
  ): Promise<void> {
    let ok = false;
    let snippet: string | null = null;
    try {
      if (!channel.TargetEmail) {
        snippet = 'Canal Email sans destinataire';
      } else {
        const publicUrl = this.publicUrl(offer.PublicToken);
        const share = buildShareContent(offer, publicUrl);
        const closing = trigger === 'Close';
        ok = await this.mail.send({
          to: channel.TargetEmail,
          subject: closing
            ? `Offre cloturee : ${offer.Title} (${CLIENT_SHORT_NAME})`
            : `Nouvelle offre a diffuser : ${offer.Title} (${CLIENT_SHORT_NAME})`,
          html: renderEmailHtml({
            accent: closing ? 'danger' : 'primary',
            chipLabel: 'Diffusion',
            title: closing ? 'Offre cloturee' : 'Nouvelle offre publiee',
            bodyLines: closing
              ? [
                  `Le poste <strong>${offer.Title}</strong> est pourvu ou l'offre est cloturee.`,
                  "Merci de retirer l'annonce des supports ou elle a ete relayee.",
                ]
              : [
                  `Une nouvelle offre est disponible pour diffusion : <strong>${offer.Title}</strong>.`,
                  share.plainText.replace(/\n/g, '<br>'),
                ],
            ctaLabel: "Voir l'offre",
            ctaHref: publicUrl,
          }),
        });
        snippet = ok ? 'Email envoye' : 'Email non envoye (MailService)';
      }
    } catch (err) {
      ok = false;
      snippet = (err instanceof Error ? `${err.name}: ${err.message}` : String(err)).slice(0, SNIPPET_CAP);
    }
    await this.prisma.jobOfferDistribution.update({
      where: { Id: rowId },
      data: {
        Status: ok ? 'Sent' : 'Failed',
        Trigger: trigger,
        Attempts: { increment: 1 },
        ResponseSnippet: snippet,
        LastAttemptAt: new Date(),
        ChannelName: channel.Name,
        ChannelKind: channel.Kind,
        ModifiedBy: actorId,
        ModifiedAt: new Date(),
      },
    });
  }

  // ---- Points d'entree explicites (endpoints RH) ------------------------

  async retryOne(offerId: string, distId: string): Promise<JobOfferDistribution> {
    const row = await this.prisma.jobOfferDistribution.findUnique({ where: { Id: distId } });
    if (!row || row.JobOfferId !== offerId) {
      throw new NotFoundException(`Diffusion ${distId} introuvable pour cette offre`);
    }
    if (row.ChannelKind !== 'Webhook') {
      throw new BadRequestException('Seule une diffusion par webhook peut etre relancee');
    }
    const channel = await this.prisma.distributionChannel.findUnique({ where: { Id: row.ChannelId } });
    if (!channel || channel.IsDeleted || !channel.IsActive) {
      throw new BadRequestException('Le canal associe est inactif ou supprime');
    }
    const offer = await this.prisma.jobOffer.findUnique({ where: { Id: row.JobOfferId } });
    if (!offer || offer.IsDeleted) {
      throw new NotFoundException(`Offre ${row.JobOfferId} introuvable`);
    }
    const actorId = await resolvePortalAuthorId(this.prisma);
    return this.sendWebhookForRow(row.Id, offer, channel, row.Trigger as DistributionTrigger, actorId);
  }

  async testChannel(channelId: string): Promise<{ ok: boolean; httpStatus: number | null; snippet: string | null }> {
    const channel = await this.prisma.distributionChannel.findUnique({ where: { Id: channelId } });
    if (!channel || channel.IsDeleted) {
      throw new NotFoundException(`Canal ${channelId} introuvable`);
    }
    if (channel.Kind !== 'Webhook') {
      throw new BadRequestException('Seul un canal de type Webhook peut etre teste');
    }
    if (!channel.TargetUrl || !isAllowedWebhookUrl(channel.TargetUrl)) {
      throw new BadRequestException('URL de webhook non autorisee');
    }
    const result = await this.performWebhook(
      channel.TargetUrl,
      { event: 'channel.test', sentAt: new Date().toISOString(), sample: true, channel: { id: channel.Id, name: channel.Name } },
      channel.Secret ?? null,
      'channel.test',
    );
    return { ok: result.ok, httpStatus: result.httpStatus, snippet: result.snippet };
  }
}

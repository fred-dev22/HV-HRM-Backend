import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { frontendOrigin } from '../../mail/email-templates';
import {
  CLIENT_SHORT_NAME,
  FEED_DESCRIPTION_MAX,
  FEED_RENDER_TTL_MS,
} from '../recruitment.constants';
import { buildIndeedXml, buildJsonFeed, FeedMeta, FeedOffer } from './job-feed.util';

interface RenderCache {
  at: number;
  json: Record<string, unknown>;
  xml: string;
}

// Flux publics tirables des offres publiees. Un seul rendu (objet JSON +
// chaine XML) memoise pendant FEED_RENDER_TTL_MS : le cout reste O(1) quel
// que soit le rythme d'interrogation des agregateurs. Ne touche JAMAIS a
// Views (ce compteur est reserve a la page humaine getByToken).
@Injectable()
export class JobFeedService {
  private cache: RenderCache | null = null;

  constructor(private readonly prisma: PrismaService) {}

  private feedTitle(): string {
    return process.env.FEED_TITLE?.trim() || `Offres d'emploi ${CLIENT_SHORT_NAME}`;
  }

  private origin(): string {
    return frontendOrigin().replace(/\/+$/, '');
  }

  private readonly jobUrl = (token: string): string => `${this.origin()}/careers/${token}`;

  private meta(now: Date): FeedMeta {
    const origin = this.origin();
    return {
      title: this.feedTitle(),
      homePageUrl: `${origin}/careers`,
      feedUrlJson: `${origin}/api/public/careers/feed.json`,
      feedUrlXml: `${origin}/api/public/careers/feed.xml`,
      publisher: CLIENT_SHORT_NAME,
      now,
    };
  }

  private async render(): Promise<RenderCache> {
    const now = new Date();
    const rows = await this.prisma.jobOffer.findMany({
      where: { Status: 'Published', IsDeleted: false, ExcludeFromFeed: false },
      orderBy: { PublishedAt: 'desc' },
      select: {
        Title: true,
        EntityName: true,
        ContractType: true,
        Location: true,
        Description: true,
        SalaryText: true,
        PublicToken: true,
        PublishedAt: true,
        ModifiedAt: true,
        CreatedAt: true,
      },
    });
    const offers: FeedOffer[] = rows.map((r) => ({ ...r }));
    const meta = this.meta(now);
    return {
      at: Date.now(),
      json: buildJsonFeed(meta, offers, this.jobUrl, FEED_DESCRIPTION_MAX),
      xml: buildIndeedXml(meta, offers, this.jobUrl, FEED_DESCRIPTION_MAX),
    };
  }

  private async cached(): Promise<RenderCache> {
    if (this.cache && Date.now() - this.cache.at < FEED_RENDER_TTL_MS) {
      return this.cache;
    }
    this.cache = await this.render();
    return this.cache;
  }

  async getJson(): Promise<Record<string, unknown>> {
    return (await this.cached()).json;
  }

  async getXml(): Promise<string> {
    return (await this.cached()).xml;
  }
}

// Generateurs de flux d'offres faits main (meme parti pris que ics.util.ts :
// aucune dependance). buildJsonFeed -> objet JSON Feed 1.1 avec un bloc
// schema.org JobPosting par offre (consommateurs "Google for Jobs") ;
// buildIndeedXml -> XML <source>/<job> facon Indeed, format de backfill
// accepte par la plupart des jobboards / ATS.

export interface FeedOffer {
  Title: string;
  EntityName: string;
  ContractType: string;
  Location: string;
  Description: string;
  SalaryText: string | null;
  PublicToken: string;
  PublishedAt: Date | null;
  ModifiedAt: Date | null;
  CreatedAt: Date;
}

export interface FeedMeta {
  title: string;
  homePageUrl: string;
  feedUrlJson: string;
  feedUrlXml: string;
  publisher: string;
  now: Date;
}

// Pays fixe : instance mono-pays (Madagascar).
const COUNTRY = 'MG';

// FR + EN -> jeton schema.org employmentType. Renvoie null si inconnu ;
// l'appelant emet toujours aussi la chaine brute.
export function employmentTypeFor(raw: string): string | null {
  const k = (raw ?? '').trim().toLowerCase();
  const map: Record<string, string> = {
    cdi: 'FULL_TIME',
    permanent: 'FULL_TIME',
    'temps plein': 'FULL_TIME',
    'full time': 'FULL_TIME',
    'full-time': 'FULL_TIME',
    cdd: 'TEMPORARY',
    fixedterm: 'TEMPORARY',
    'fixed term': 'TEMPORARY',
    'fixed-term': 'TEMPORARY',
    temporaire: 'TEMPORARY',
    interim: 'TEMPORARY',
    stage: 'INTERN',
    stagiaire: 'INTERN',
    internship: 'INTERN',
    intern: 'INTERN',
    alternance: 'APPRENTICE',
    apprentissage: 'APPRENTICE',
    apprenti: 'APPRENTICE',
    apprenticeship: 'APPRENTICE',
    workstudy: 'APPRENTICE',
    'work study': 'APPRENTICE',
    'work-study': 'APPRENTICE',
    freelance: 'CONTRACTOR',
    independant: 'CONTRACTOR',
    'independent': 'CONTRACTOR',
    contractor: 'CONTRACTOR',
    prestation: 'CONTRACTOR',
    'temps partiel': 'PART_TIME',
    'part time': 'PART_TIME',
    'part-time': 'PART_TIME',
    parttime: 'PART_TIME',
  };
  return map[k] ?? null;
}

function xmlEscape(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Section CDATA sure : neutralise toute sequence ]]> presente dans le texte
// libre RH pour ne pas casser le document.
export function cdata(s: string): string {
  return '<![CDATA[' + String(s ?? '').replace(/]]>/g, ']]]]><![CDATA[>') + ']]>';
}

// Date RFC 822 en GMT pour les crawlers de jobboards (toUTCString).
export function rfc822(d: Date): string {
  return d.toUTCString();
}

// Coupe une description trop longue (protege les flux d'une description de
// plusieurs centaines de Ko collee par le RH). Pas de tiret cadratin.
export function capFeedText(desc: string, max: number): string {
  const s = String(desc ?? '').replace(/\r\n/g, '\n');
  if (s.length <= max) return s;
  return s.slice(0, max).trimEnd() + "\n\n[...] Voir l'offre complete en ligne.";
}

function postedDate(o: FeedOffer): Date {
  return o.PublishedAt ?? o.ModifiedAt ?? o.CreatedAt;
}

export function buildJsonFeed(
  meta: FeedMeta,
  offers: FeedOffer[],
  jobUrl: (token: string) => string,
  descMax: number,
): Record<string, unknown> {
  return {
    version: 'https://jsonfeed.org/version/1.1',
    title: meta.title,
    home_page_url: meta.homePageUrl,
    feed_url: meta.feedUrlJson,
    updated: meta.now.toISOString(),
    items: offers.map((o) => {
      const posted = postedDate(o);
      const url = jobUrl(o.PublicToken);
      const rawType = o.ContractType;
      const mapped = employmentTypeFor(rawType);
      const jobPosting: Record<string, unknown> = {
        '@context': 'https://schema.org/',
        '@type': 'JobPosting',
        title: o.Title,
        description: capFeedText(o.Description, descMax),
        datePosted: posted.toISOString(),
        employmentType: mapped ? [mapped, rawType] : rawType,
        hiringOrganization: { '@type': 'Organization', name: o.EntityName },
        jobLocation: {
          '@type': 'Place',
          address: {
            '@type': 'PostalAddress',
            addressLocality: o.Location,
            addressCountry: COUNTRY,
          },
        },
        identifier: {
          '@type': 'PropertyValue',
          name: o.EntityName,
          value: o.PublicToken,
        },
        directApply: true,
        url,
      };
      if (o.SalaryText) {
        jobPosting.baseSalary = {
          '@type': 'MonetaryAmount',
          currency: 'MGA',
          value: { '@type': 'QuantitativeValue', value: o.SalaryText },
        };
      }
      return {
        id: o.PublicToken,
        url,
        title: o.Title,
        content_text: capFeedText(o.Description, descMax),
        date_published: posted.toISOString(),
        _job_posting: jobPosting,
      };
    }),
  };
}

export function buildIndeedXml(
  meta: FeedMeta,
  offers: FeedOffer[],
  jobUrl: (token: string) => string,
  descMax: number,
): string {
  const lines: string[] = [];
  lines.push('<?xml version="1.0" encoding="utf-8"?>');
  lines.push('<source>');
  lines.push(`  <publisher>${xmlEscape(meta.publisher)}</publisher>`);
  lines.push(`  <publisherurl>${xmlEscape(meta.homePageUrl)}</publisherurl>`);
  lines.push(`  <lastBuildDate>${rfc822(meta.now)}</lastBuildDate>`);
  for (const o of offers) {
    lines.push('  <job>');
    lines.push(`    <title>${cdata(o.Title)}</title>`);
    lines.push(`    <date>${rfc822(postedDate(o))}</date>`);
    lines.push(`    <referencenumber>${cdata(o.PublicToken)}</referencenumber>`);
    lines.push(`    <url>${cdata(jobUrl(o.PublicToken))}</url>`);
    lines.push(`    <company>${cdata(meta.publisher)}</company>`);
    lines.push(`    <city>${cdata(o.Location)}</city>`);
    lines.push(`    <country>${COUNTRY}</country>`);
    lines.push(`    <jobtype>${cdata(o.ContractType)}</jobtype>`);
    lines.push(`    <category>${cdata(o.EntityName)}</category>`);
    if (o.SalaryText) lines.push(`    <salary>${cdata(o.SalaryText)}</salary>`);
    lines.push(`    <description>${cdata(capFeedText(o.Description, descMax))}</description>`);
    lines.push('  </job>');
  }
  lines.push('</source>');
  return lines.join('\n') + '\n';
}

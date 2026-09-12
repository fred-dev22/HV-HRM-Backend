import { CLIENT_SHORT_NAME } from '../recruitment.constants';

// Contenu pret a coller pour une diffusion manuelle (LinkedIn, X, intranet,
// email cabinet). Tout en francais, aucun tiret cadratin, longueurs bornees.

export interface ShareContentOffer {
  Title: string;
  EntityName: string;
  ContractType: string;
  Location: string;
  Description: string;
  SalaryText?: string | null;
}

export interface ShareContent {
  plainText: string;
  markdown: string;
  linkedinPost: string;
  twitterShort: string;
  publicUrl: string;
}

const LINKEDIN_MAX = 1299;
const TWITTER_MAX = 280;

const CONTRACT_LABELS: Record<string, string> = {
  CDI: 'CDI',
  CDD: 'CDD',
  Permanent: 'CDI',
  FixedTerm: 'CDD',
  Internship: 'Stage',
  Stage: 'Stage',
  Freelance: 'Freelance',
  Apprenticeship: 'Alternance',
  Apprentissage: 'Alternance',
  Alternance: 'Alternance',
  WorkStudy: 'Alternance',
};

function contractLabel(raw: string): string {
  return CONTRACT_LABELS[raw] ?? raw;
}

// Normalise le texte final : retire tout tiret cadratin / demi-cadratin qui
// aurait pu remonter du texte libre RH (regle "pas de tiret cadratin").
function noDash(s: string): string {
  return s.replace(/[–—]/g, '-');
}

// Description libre RH -> texte plat court : retire le HTML grossier, ecrase
// les espaces, coupe proprement.
function plainSummary(description: string, max: number): string {
  const stripped = String(description ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();
  if (stripped.length <= max) return stripped;
  return stripped.slice(0, max - 3).trimEnd() + '...';
}

function hashtag(value: string): string {
  const t = String(value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '');
  return t ? '#' + t : '';
}

export function buildShareContent(offer: ShareContentOffer, publicUrl: string): ShareContent {
  const org = CLIENT_SHORT_NAME;
  const type = contractLabel(offer.ContractType);
  const salaryLine = offer.SalaryText ? `Remuneration : ${offer.SalaryText}` : null;

  const plainText = noDash(
    [
      `${offer.Title} chez ${org}`,
      `Type de contrat : ${type}`,
      `Lieu : ${offer.Location}`,
      salaryLine,
      '',
      plainSummary(offer.Description, 600),
      '',
      `Pour postuler : ${publicUrl}`,
    ]
      .filter((l): l is string => l !== null)
      .join('\n'),
  );

  const markdown = noDash(
    [
      `### ${offer.Title} chez ${org}`,
      '',
      `- **Type de contrat :** ${type}`,
      `- **Lieu :** ${offer.Location}`,
      salaryLine ? `- **${salaryLine}**` : null,
      '',
      plainSummary(offer.Description, 800),
      '',
      `[Postuler en ligne](${publicUrl})`,
    ]
      .filter((l): l is string => l !== null)
      .join('\n'),
  );

  const hashtags = ['#recrutement', hashtag(offer.Location), `#${org}`]
    .filter(Boolean)
    .join(' ');

  const linkedinHead =
    `${org} recrute : ${offer.Title}\n\n` +
    `Contrat ${type} base a ${offer.Location}.` +
    (salaryLine ? ` ${salaryLine}.` : '');
  const linkedinTail = `\n\nCandidatures ici : ${publicUrl}\n\n${hashtags}`;
  const budget = LINKEDIN_MAX - linkedinHead.length - linkedinTail.length - 2;
  let linkedinPost = noDash(
    `${linkedinHead}\n\n${plainSummary(offer.Description, Math.max(80, budget))}${linkedinTail}`,
  );
  if (linkedinPost.length > LINKEDIN_MAX) linkedinPost = linkedinPost.slice(0, LINKEDIN_MAX).trimEnd();

  const twSuffix = `. Postulez : ${publicUrl}`;
  let twPrefix = `${offer.Title} chez ${org} (${offer.Location})`;
  while (twPrefix.length > 0 && (twPrefix + twSuffix).length > TWITTER_MAX) {
    twPrefix = twPrefix.slice(0, -1).trimEnd();
  }
  let twitterShort = noDash(twPrefix + twSuffix);
  if (twitterShort.length > TWITTER_MAX) twitterShort = twitterShort.slice(0, TWITTER_MAX);

  return { plainText, markdown, linkedinPost, twitterShort, publicUrl };
}

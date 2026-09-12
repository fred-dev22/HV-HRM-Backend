import { Logger } from '@nestjs/common';
import { createHmac, randomBytes, timingSafeEqual } from 'crypto';

// Anti-spam du portail carriere public — couche "temps passe sur le
// formulaire" (jeton HMAC sans etat) + liste des champs pot-de-miel.
// Aucune dependance, aucun stockage en base : meme parti pris hand-roll que
// mail.service.ts / ics.util.ts / rate-limit.store.ts. Un seul process Node
// (voir la note "montee en charge" du RateLimitStore) : la Map des jtis
// consommes est per-process.

const logger = new Logger('CareersAntispam');

// Champs pot-de-miel. Ils DOIVENT etre declares dans PublicApplyDto : le
// ValidationPipe global tourne avec forbidNonWhitelisted:true, donc un bot
// qui les remplit serait sinon rejete par un 400 generique — ce qui lui
// revelerait leur existence. Declares + ignores cote service, la detection
// reste invisible (meme reponse qu'une vraie candidature).
export const HONEYPOT_FIELDS = ['Website', 'Fax'] as const;

export type FormTokenResult =
  | 'ok'
  | 'missing'
  | 'bad'
  | 'too_young'
  | 'too_old'
  | 'reused';

interface FormTokenPayload {
  jti: string;
  iat: number;
}

// Secret HMAC. CAREERS_FORM_SECRET defini => les jetons survivent a un
// redemarrage. Sinon un secret aleatoire est genere au boot : les jetons
// deja emis deviennent invalides apres un redemarrage (rare, recuperable :
// l'utilisateur voit "Ce formulaire a expire, merci de recharger la page").
// Meme convention "ne bloque pas le demarrage" que le bloc GRAPH_*.
let bootSecret: Buffer | undefined;

function formSecret(): Buffer {
  const fromEnv = process.env.CAREERS_FORM_SECRET;
  if (fromEnv) return Buffer.from(fromEnv, 'utf8');
  if (!bootSecret) {
    bootSecret = randomBytes(32);
    if (process.env.NODE_ENV === 'production') {
      logger.warn(
        'CAREERS_FORM_SECRET absent : un secret aleatoire est genere au demarrage. ' +
          'Les jetons de formulaire deja emis seront invalides apres chaque redemarrage.',
      );
    }
  }
  return bootSecret;
}

// Accepte les valeurs fractionnaires (ex. CAREERS_MAX_FORM_MINUTES=0.1).
function numEnv(v: string | undefined, def: number): number {
  const n = v !== undefined && v !== '' ? Number(v) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : def;
}

function minFormMs(): number {
  return numEnv(process.env.CAREERS_MIN_FORM_SECONDS, 0) * 1_000;
}

function maxFormMs(): number {
  return numEnv(process.env.CAREERS_MAX_FORM_MINUTES, 60) * 60_000;
}

function b64url(buf: Buffer): string {
  return buf.toString('base64url');
}

function sign(payloadPart: string): Buffer {
  return createHmac('sha256', formSecret()).update(payloadPart).digest();
}

// Valeurs echoees au SPA (GET /public/careers/form-token et la forme d'offre)
// pour afficher un indice de duree sans coder les defauts en dur cote client.
export function formTokenHints(): { minSeconds: number; maxMinutes: number } {
  return {
    minSeconds: numEnv(process.env.CAREERS_MIN_FORM_SECONDS, 0),
    maxMinutes: numEnv(process.env.CAREERS_MAX_FORM_MINUTES, 60),
  };
}

// base64url(JSON{jti,iat}) + '.' + base64url(HMAC-SHA256(payloadPart, secret)).
export function issueFormToken(): string {
  const payload: FormTokenPayload = {
    jti: b64url(randomBytes(12)),
    iat: Date.now(),
  };
  const payloadPart = b64url(Buffer.from(JSON.stringify(payload), 'utf8'));
  const sigPart = b64url(sign(payloadPart));
  return `${payloadPart}.${sigPart}`;
}

// jti -> date d'expiration (ms epoch). Usage unique : un rejeu renvoie
// 'reused'. Purge PARESSEUSE : on evince les entrees expirees au debut de
// chaque verifyFormToken(). Pas de timer, aucun couplage au RateLimitStore.
const consumed = new Map<string, number>();

export function pruneConsumedFormTokens(now: number = Date.now()): void {
  for (const [jti, expiresAt] of consumed) {
    if (expiresAt <= now) consumed.delete(jti);
  }
}

export function verifyFormToken(token?: string): FormTokenResult {
  const now = Date.now();
  // Purge paresseuse a chaque appel (borne la memoire sans timer).
  pruneConsumedFormTokens(now);

  if (!token) {
    // Absence toleree sauf si explicitement exige (defaut permissif pour la
    // demo HV et les E2E existantes).
    return process.env.CAREERS_FORM_TOKEN_REQUIRED === 'true' ? 'missing' : 'ok';
  }

  const dot = token.indexOf('.');
  if (dot <= 0 || dot === token.length - 1) return 'bad';
  const payloadPart = token.slice(0, dot);
  const sigPart = token.slice(dot + 1);

  let providedSig: Buffer;
  try {
    providedSig = Buffer.from(sigPart, 'base64url');
  } catch {
    return 'bad';
  }
  const expectedSig = sign(payloadPart);
  // Garde-longueur AVANT timingSafeEqual : il jette si les buffers n'ont pas
  // la meme taille. base64/JSON malformes => 'bad', jamais un 500.
  if (providedSig.length !== expectedSig.length) return 'bad';
  if (!timingSafeEqual(providedSig, expectedSig)) return 'bad';

  let payload: FormTokenPayload;
  try {
    const raw = Buffer.from(payloadPart, 'base64url').toString('utf8');
    const parsed = JSON.parse(raw) as Partial<FormTokenPayload>;
    if (
      !parsed ||
      typeof parsed.jti !== 'string' ||
      typeof parsed.iat !== 'number' ||
      !Number.isFinite(parsed.iat)
    ) {
      return 'bad';
    }
    payload = { jti: parsed.jti, iat: parsed.iat };
  } catch {
    return 'bad';
  }

  const age = now - payload.iat;
  // iat dans le futur : jeton forge / horloge incoherente.
  if (age < 0) return 'bad';
  const maxMs = maxFormMs();
  if (age < minFormMs()) return 'too_young';
  if (age > maxMs) return 'too_old';

  // Check-then-set SYNCHRONE : aucun await entre le has() et le set(), donc
  // deux POST concurrents portant le meme jeton ne peuvent pas passer tous
  // les deux dans le Node mono-thread (idempotence du double-clic SPA).
  if (consumed.has(payload.jti)) return 'reused';
  consumed.set(payload.jti, now + maxMs);
  return 'ok';
}

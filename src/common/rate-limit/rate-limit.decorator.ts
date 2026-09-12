import { SetMetadata } from '@nestjs/common';

// Limitation de debit pour les routes publiques (portail carriere, RSVP
// entretien, flux d'offres). Hand-roll en memoire, sans dependance
// (@nestjs/throttler n'est pas installe) — meme parti pris que
// mail.service.ts / sharepoint.service.ts / ics.util.ts.
//
// Les seuils sont des thunks lisant process.env : ils peuvent etre ajustes
// (ou desactives) sans rebuild, et les tests E2E peuvent les changer par
// scenario. Tout est permissif par defaut pour ne pas gener la demo HV.

export const RATE_LIMIT_KEY = 'rateLimit';

export type RlBucket = 'apply' | 'read' | 'token' | 'rsvp';

export interface RlConfig {
  bucket: RlBucket;
  limit: number;
  windowMs: number;
}

function int(v: string | undefined, def: number): number {
  const n = v ? Number.parseInt(v, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : def;
}

// Resolus a chaque acces (pas au chargement du module) pour rester tunables.
export function resolveRlConfig(bucket: RlBucket): RlConfig {
  switch (bucket) {
    case 'apply':
      return {
        bucket,
        limit: int(process.env.CAREERS_RL_APPLY, 5),
        windowMs: int(process.env.CAREERS_RL_APPLY_WINDOW_MS, 60_000),
      };
    case 'token':
      return {
        bucket,
        limit: int(process.env.CAREERS_RL_TOKEN, 30),
        windowMs: int(process.env.CAREERS_RL_TOKEN_WINDOW_MS, 60_000),
      };
    case 'rsvp':
      return {
        bucket,
        limit: int(process.env.CAREERS_RL_RSVP, 30),
        windowMs: int(process.env.CAREERS_RL_RSVP_WINDOW_MS, 600_000),
      };
    case 'read':
    default:
      return {
        bucket,
        limit: int(process.env.CAREERS_RL_READ, 60),
        windowMs: int(process.env.CAREERS_RL_READ_WINDOW_MS, 60_000),
      };
  }
}

// Pose le nom du bucket sur la route ; la config reelle est resolue dans le
// guard (via resolveRlConfig) pour rester sensible aux changements d'env.
export const RateLimit = (bucket: RlBucket) => SetMetadata(RATE_LIMIT_KEY, bucket);

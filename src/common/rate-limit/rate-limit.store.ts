import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';

// Fenetre glissante en memoire (un seul process Node — voir la note
// "montee en charge" plus bas). Cle = `${bucket}:${ip}` -> horodatages
// ascendants des requetes retenues.
@Injectable()
export class RateLimitStore {
  private readonly logger = new Logger(RateLimitStore.name);
  private readonly buckets = new Map<string, number[]>();

  // Garde-fou memoire contre un flood de cles (IP tournantes) : au-dela on
  // evince la plus ancienne cle. Pire cas sous attaque = un fail-open
  // occasionnel pour un client legitime, jamais une croissance illimitee.
  private static readonly MAX_KEYS = 100_000;

  hit(key: string, limit: number, windowMs: number): { allowed: boolean; retryAfterSec: number } {
    if (process.env.CAREERS_RL_DISABLED === 'true') {
      return { allowed: true, retryAfterSec: 0 };
    }
    const now = Date.now();
    const cutoff = now - windowMs;
    let hits = this.buckets.get(key);
    if (!hits) {
      if (this.buckets.size >= RateLimitStore.MAX_KEYS) {
        const oldest = this.buckets.keys().next().value;
        if (oldest !== undefined) this.buckets.delete(oldest);
      }
      hits = [];
      this.buckets.set(key, hits);
    }
    // Purge les horodatages sortis de la fenetre.
    while (hits.length && hits[0]! <= cutoff) hits.shift();

    if (hits.length >= limit) {
      const retryAfterSec = Math.max(1, Math.ceil((hits[0]! + windowMs - now) / 1000));
      return { allowed: false, retryAfterSec };
    }
    hits.push(now);
    return { allowed: true, retryAfterSec: 0 };
  }

  // Balayage : retire les horodatages de plus d'une heure et les cles vides.
  @Interval(60_000)
  sweep(): void {
    const cutoff = Date.now() - 3_600_000;
    for (const [key, hits] of this.buckets) {
      while (hits.length && hits[0]! <= cutoff) hits.shift();
      if (hits.length === 0) this.buckets.delete(key);
    }
  }
}

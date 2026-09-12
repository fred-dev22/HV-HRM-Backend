import { Injectable, Logger } from '@nestjs/common';

// Verification Cloudflare Turnstile — meme parti pris que mail.service.ts /
// sharepoint.service.ts : fetch pur, aucune dependance / SDK. Entierement
// optionnel et pilote par l'environnement :
//   - TURNSTILE_SECRET absent   => captcha desactive (verify renvoie skipped)
//   - erreur reseau / timeout   => fail-open, sauf TURNSTILE_FAIL_OPEN=false
// Aucun secret n'est jamais renvoye par l'API applicative.
interface TurnstileVerifyResponse {
  success: boolean;
  'error-codes'?: string[];
}

@Injectable()
export class TurnstileService {
  private readonly logger = new Logger(TurnstileService.name);

  private static readonly ENDPOINT =
    'https://challenges.cloudflare.com/turnstile/v0/siteverify';
  // Timeout court : une Cloudflare qui pend ne doit pas immobiliser un thread
  // de requete cote portail public.
  private static readonly TIMEOUT_MS = 5_000;

  // token indefini => le SPA n'a pas affiche de widget (VITE_TURNSTILE_SITE_KEY
  // absent) ou l'utilisateur n'a pas resolu le defi. ip = client reel resolu
  // par ClientIp (peut valoir 'unknown').
  async verify(
    token: string | undefined,
    ip: string,
  ): Promise<{ ok: boolean; skipped: boolean }> {
    const secret = process.env.TURNSTILE_SECRET;
    if (!secret) {
      // Captcha desactive tant que TURNSTILE_SECRET n'est pas defini.
      return { ok: true, skipped: true };
    }
    if (!token) {
      // Captcha actif mais aucun jeton fourni : echec franc.
      return { ok: false, skipped: false };
    }

    const body = new URLSearchParams({ secret, response: token });
    if (ip && ip !== 'unknown') {
      body.set('remoteip', ip);
    }

    try {
      const res = await fetch(TurnstileService.ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
        signal: AbortSignal.timeout(TurnstileService.TIMEOUT_MS),
      });
      if (!res.ok) {
        this.logger.warn(
          `Turnstile siteverify a repondu ${res.status} ; fail-open=${this.failOpen()}`,
        );
        return { ok: this.failOpen(), skipped: false };
      }
      const data = (await res.json()) as TurnstileVerifyResponse;
      if (!data.success) {
        // ['timeout-or-duplicate'] quand un jeton est rejoue : le front doit
        // appeler window.turnstile.reset() pour repartir sur un defi neuf.
        this.logger.debug(
          `Turnstile a rejete le jeton : ${
            (data['error-codes'] ?? []).join(', ') || 'aucun code'
          }`,
        );
      }
      return { ok: Boolean(data.success), skipped: false };
    } catch (err) {
      // Timeout / DNS / reseau : fail-open par defaut (on ne bloque pas les
      // candidats quand le fournisseur anti-bot est injoignable). Basculer
      // TURNSTILE_FAIL_OPEN=false pour fermer pendant une fenetre d'abus.
      this.logger.warn(
        `Verification Turnstile impossible (${
          (err as Error)?.message ?? 'erreur inconnue'
        }), fail-open=${this.failOpen()}`,
      );
      return { ok: this.failOpen(), skipped: false };
    }
  }

  private failOpen(): boolean {
    return process.env.TURNSTILE_FAIL_OPEN !== 'false';
  }
}

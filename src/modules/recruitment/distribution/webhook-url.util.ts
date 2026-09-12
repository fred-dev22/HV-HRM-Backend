import { createHmac } from 'crypto';

// Garde SSRF des URL de webhook sortant. https uniquement (http tolere
// derriere ALLOW_INSECURE_WEBHOOKS) ; boucle locale / plages privees /
// link-local / localhost bloques sauf ALLOW_PRIVATE_WEBHOOKS=1 (cas d'un
// n8n auto-heberge sur la meme machine). Fait main, sans dependance : meme
// parti pris que mail.service.ts / ics.util.ts.

function envOn(name: string): boolean {
  const v = process.env[name];
  return v === '1' || v === 'true';
}

// Vrai si l'hote est une boucle locale, une plage privee, du link-local,
// du CGNAT ou du multicast/reserve. Le blocage porte sur la valeur litterale
// de l'URL (pas de resolution DNS) : redirect:'error' cote fetch empeche
// qu'une redirection contourne ce controle.
export function isPrivateOrLocalHost(rawHost: string): boolean {
  const h = rawHost.toLowerCase().replace(/^\[/, '').replace(/\]$/, '');
  if (!h) return true;
  if (h === 'localhost' || h.endsWith('.localhost')) return true;
  if (h === '::1' || h === '0:0:0:0:0:0:0:1') return true;
  // IPv6 unique-local fc00::/7
  if (/^f[cd][0-9a-f]{2}:/.test(h)) return true;
  // IPv6 link-local fe80::/10
  if (/^fe[89ab][0-9a-f]:/.test(h)) return true;
  // IPv4 pointe
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    if ([a, b, Number(m[3]), Number(m[4])].some((n) => n > 255)) return true;
    if (a === 0 || a === 127) return true; // 0.0.0.0/8, loopback
    if (a === 10) return true; // 10/8
    if (a === 192 && b === 168) return true; // 192.168/16
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12
    if (a === 169 && b === 254) return true; // link-local
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64/10
    if (a >= 224) return true; // multicast / reserve
  }
  return false;
}

export function isAllowedWebhookUrl(raw: string | null | undefined): boolean {
  if (!raw) return false;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
  if (u.protocol === 'http:' && !envOn('ALLOW_INSECURE_WEBHOOKS')) return false;
  if (!u.hostname) return false;
  if (isPrivateOrLocalHost(u.hostname) && !envOn('ALLOW_PRIVATE_WEBHOOKS')) return false;
  return true;
}

// Signature du corps du webhook : 'sha256=' + HMAC-SHA256 hex. Emise dans
// l'entete X-Productive247-Signature quand le canal a un Secret.
export function signBody(secret: string, body: string): string {
  return 'sha256=' + createHmac('sha256', secret).update(body, 'utf8').digest('hex');
}

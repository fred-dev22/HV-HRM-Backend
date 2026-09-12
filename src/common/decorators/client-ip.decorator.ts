import { createParamDecorator, ExecutionContext } from '@nestjs/common';

// X-Forwarded-For n'est pris en compte QUE si CAREERS_TRUST_PROXY=true, et
// seulement le premier saut (le client reel). Sans ca, derriere un LB non
// configure tout le trafic tomberait dans le meme bucket — fail-safe :
// on sur-limite plutot que de sous-limiter. Le proxy de bord DOIT ecraser
// (pas ajouter a) l'entete XFF, et le port applicatif ne doit pas etre
// joignable en direct (voir .env.example).
export function resolveClientIp(req: {
  headers?: Record<string, unknown>;
  ip?: string;
  socket?: { remoteAddress?: string };
}): string {
  if (process.env.CAREERS_TRUST_PROXY === 'true') {
    const xff = String(req.headers?.['x-forwarded-for'] ?? '')
      .split(',')[0]
      ?.trim();
    if (xff) return xff;
  }
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

export const ClientIp = createParamDecorator((_data: unknown, ctx: ExecutionContext): string =>
  resolveClientIp(ctx.switchToHttp().getRequest()),
);

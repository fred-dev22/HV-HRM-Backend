import { CanActivate, ExecutionContext, HttpException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RateLimitStore } from './rate-limit.store';
import { RATE_LIMIT_KEY, RlBucket, resolveRlConfig } from './rate-limit.decorator';
import { resolveClientIp } from '../decorators/client-ip.decorator';

// Guard de limitation de debit pour les routes publiques. Tourne APRES les
// deux guards globaux (Jwt puis Permission) qui ne font rien sur une route
// @Public(), donc c'est bien lui qui protege ces routes. Sans @RateLimit()
// sur la route, le guard laisse passer (aucune limite).
@Injectable()
export class SlidingWindowRateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly store: RateLimitStore,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const bucket = this.reflector.getAllAndOverride<RlBucket>(RATE_LIMIT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!bucket) return true;

    const req = context.switchToHttp().getRequest();
    const res = context.switchToHttp().getResponse();
    const cfg = resolveRlConfig(bucket);
    const ip = resolveClientIp(req);
    const result = this.store.hit(`${bucket}:${ip}`, cfg.limit, cfg.windowMs);
    if (!result.allowed) {
      if (typeof res?.setHeader === 'function') {
        res.setHeader('Retry-After', String(result.retryAfterSec));
      }
      throw new HttpException('Trop de tentatives, merci de réessayer dans quelques minutes.', 429);
    }
    return true;
  }
}

import { Global, Module } from '@nestjs/common';
import { RateLimitStore } from './rate-limit.store';
import { SlidingWindowRateLimitGuard } from './sliding-window-rate-limit.guard';

// @Global() : un seul store en memoire, partage par toutes les routes
// publiques (portail carriere, RSVP entretien, futurs flux). Importe une
// seule fois dans AppModule.
@Global()
@Module({
  providers: [RateLimitStore, SlidingWindowRateLimitGuard],
  exports: [RateLimitStore, SlidingWindowRateLimitGuard],
})
export class RateLimitModule {}

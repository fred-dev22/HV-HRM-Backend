import {
  Body,
  Controller,
  Get,
  Header,
  Headers,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Public } from '../../auth/decorators/public.decorator';
import { SlidingWindowRateLimitGuard } from '../../../common/rate-limit/sliding-window-rate-limit.guard';
import { RateLimit } from '../../../common/rate-limit/rate-limit.decorator';
import { InterviewRsvpService } from './interview-rsvp.service';
import { InboundIcsDto, RsvpResponseDto } from './dto/interview-rsvp.dto';

// Suivi des reponses aux invitations calendrier via jeton public. Aucune
// permission ni JWT (voir @Public()) : l'authentification est portee par le
// jeton opaque (RsvpToken / CandidateRsvpToken). Limitation de debit par IP
// via le guard partage (bucket "rsvp"). Le GET est strictement en lecture.
@Controller('public/interview-rsvp')
@UseGuards(SlidingWindowRateLimitGuard)
@RateLimit('rsvp')
export class InterviewRsvpPublicController {
  constructor(private readonly service: InterviewRsvpService) {}

  // Doit rester avant ':token'
  @Public()
  @Post('inbound-ics')
  inboundIcs(
    @Headers('x-rsvp-secret') secret: string | undefined,
    @Body() dto: InboundIcsDto,
  ) {
    return this.service.inboundIcs(secret, dto.Ics);
  }

  @Public()
  @Header('X-Robots-Tag', 'noindex')
  @Get(':token')
  getSummary(@Param('token') token: string) {
    return this.service.getSummary(token);
  }

  @Public()
  @Post(':token')
  record(@Param('token') token: string, @Body() dto: RsvpResponseDto) {
    return this.service.record(token, dto.Response);
  }
}

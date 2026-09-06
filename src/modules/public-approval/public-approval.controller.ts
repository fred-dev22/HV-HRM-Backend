import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { Public } from '../auth/decorators/public.decorator';
import { PublicApprovalService } from './public-approval.service';
import { DecidePublicApprovalDto } from './dto/decide-public-approval.dto';

// Aucune permission ni JWT requis (voir @Public()) — l'authentification est
// portee par le jeton opaque lui-meme (ApprovalDecision.Token), pas par une
// session. Le GET est strictement en lecture (voir securite email : certains
// scanners anti-phishing pre-chargent les liens des mails recus, un GET qui
// declencherait l'action serait alors approuve/refuse a l'insu du validateur).
@Controller('public/approvals')
export class PublicApprovalController {
  constructor(private readonly service: PublicApprovalService) {}

  @Public()
  @Get(':token')
  getSummary(@Param('token') token: string) {
    return this.service.getSummary(token);
  }

  @Public()
  @Post(':token/decide')
  decide(@Param('token') token: string, @Body() dto: DecidePublicApprovalDto) {
    return this.service.decide(token, dto);
  }
}

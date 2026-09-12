import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  Post,
  UploadedFile,
  UseFilters,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Public } from '../../auth/decorators/public.decorator';
import { RecruitmentPublicService } from './recruitment-public.service';
import { PublicApplyDto } from './dto/public-apply.dto';
import { RECRUITMENT_UPLOAD, cvFileFilter } from '../attachments/recruitment-upload.util';
import { RecruitmentUploadExceptionFilter } from '../attachments/recruitment-upload-exception.filter';
import { SlidingWindowRateLimitGuard } from '../../../common/rate-limit/sliding-window-rate-limit.guard';
import { RateLimit } from '../../../common/rate-limit/rate-limit.decorator';
import { ClientIp } from '../../../common/decorators/client-ip.decorator';

const CV_INTERCEPTOR = FileInterceptor('cv', {
  limits: { fileSize: RECRUITMENT_UPLOAD.MAX_BYTES },
  fileFilter: cvFileFilter,
});

// @Public() sur chaque handler — ni JWT ni permission. Les offres sont
// adressees par jeton opaque, jamais par id interne. La protection est
// portee par SlidingWindowRateLimitGuard (limitation de debit par IP et par
// bucket) + les controles anti-spam cote service (pot-de-miel, jeton de
// formulaire, Turnstile), tous pilotes par l'environnement, defauts permissifs.
@UseGuards(SlidingWindowRateLimitGuard)
@UseFilters(RecruitmentUploadExceptionFilter)
@Controller('public/careers')
export class RecruitmentPublicController {
  constructor(private readonly service: RecruitmentPublicService) {}

  @Public()
  @RateLimit('read')
  @Get()
  listPublished() {
    return this.service.listPublished();
  }

  // Flux publics tirables (jobboards / agregateurs). Doivent rester avant
  // ':token' : sinon '/feed.json' est capture par getByToken -> 404.
  @Public()
  @RateLimit('read')
  @Get('feed.json')
  @Header('Cache-Control', 'public, max-age=300')
  @Header('Access-Control-Allow-Origin', '*')
  feedJson() {
    return this.service.feedJson();
  }

  @Public()
  @RateLimit('read')
  @Get('feed.xml')
  @Header('Content-Type', 'application/xml; charset=utf-8')
  @Header('Cache-Control', 'public, max-age=300')
  @Header('Access-Control-Allow-Origin', '*')
  feedXml() {
    return this.service.feedXml();
  }

  // Doit rester avant ':token' (NestJS route en ordre de declaration) — sinon
  // 'form-token' serait capture comme un :token d'offre.
  @Public()
  @RateLimit('token')
  @Get('form-token')
  formToken() {
    return this.service.issueFormToken();
  }

  // Doit rester avant ':token'.
  @Public()
  @RateLimit('apply')
  @Post('spontaneous')
  @UseInterceptors(CV_INTERCEPTOR)
  applySpontaneous(
    @Body() dto: PublicApplyDto,
    @ClientIp() ip: string,
    @UploadedFile() cv?: Express.Multer.File,
  ) {
    return this.service.applySpontaneous(dto, cv, ip);
  }

  @Public()
  @RateLimit('read')
  @Get(':token')
  getByToken(@Param('token') token: string) {
    return this.service.getByToken(token, true);
  }

  @Public()
  @RateLimit('apply')
  @Post(':token/apply')
  @UseInterceptors(CV_INTERCEPTOR)
  applyToOffer(
    @Param('token') token: string,
    @Body() dto: PublicApplyDto,
    @ClientIp() ip: string,
    @UploadedFile() cv?: Express.Multer.File,
  ) {
    return this.service.applyToOffer(token, dto, cv, ip);
  }
}

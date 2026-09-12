import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { RequirePermission } from '../../../common/decorators/require-permission.decorator';
import { JobOfferDistributionService } from './job-offer-distribution.service';
import { UpdateJobOfferDistributionDto } from './dto/distribution.dto';

// Sous-routes de suivi de diffusion rattachees a une offre. Controleur frere
// de JobOfferController (memes chemins /recruitment/job-offers/:id/...),
// meme permission de classe. job-offer.controller.ts reste concentre sur le
// cycle de vie de l'offre.
@Controller('recruitment/job-offers/:id')
@RequirePermission('RECRUTEMENT_ACCES')
export class JobOfferDistributionController {
  constructor(private readonly service: JobOfferDistributionService) {}

  @Get('distributions')
  list(@Param('id') id: string) {
    return this.service.list(id);
  }

  @Get('share-content')
  shareContent(@Param('id') id: string) {
    return this.service.shareContent(id);
  }

  @Patch('distributions/:distId')
  patch(
    @Param('id') id: string,
    @Param('distId') distId: string,
    @Body() dto: UpdateJobOfferDistributionDto,
    @CurrentUser('employeeId') employeeId: string,
  ) {
    return this.service.patch(id, distId, dto, employeeId);
  }

  @Post('distributions/:distId/retry')
  retry(@Param('id') id: string, @Param('distId') distId: string) {
    return this.service.retry(id, distId);
  }
}

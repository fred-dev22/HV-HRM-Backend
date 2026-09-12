import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UploadedFile,
  UseFilters,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JobOfferService } from './job-offer.service';
import { CreateJobOfferDto } from './dto/create-job-offer.dto';
import { UpdateJobOfferDto, CloseJobOfferDto } from './dto/update-job-offer.dto';
import { RECRUITMENT_UPLOAD, cvFileFilter } from '../attachments/recruitment-upload.util';
import { RecruitmentUploadExceptionFilter } from '../attachments/recruitment-upload-exception.filter';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { RequirePermission } from '../../../common/decorators/require-permission.decorator';

// RECRUTEMENT_ACCES ouvre tout le module (decision client du 05/09) : une
// seule permission de classe, pas d'etape "approuver / refuser".
@Controller('recruitment/job-offers')
@RequirePermission('RECRUTEMENT_ACCES')
@UseFilters(RecruitmentUploadExceptionFilter)
export class JobOfferController {
  constructor(private readonly service: JobOfferService) {}

  @Post()
  create(@Body() dto: CreateJobOfferDto, @CurrentUser('employeeId') employeeId: string) {
    return this.service.create(dto, employeeId);
  }

  @Get()
  findAll() {
    return this.service.findAll();
  }

  // Sous-routes documents (PDF de l'offre, grille d'evaluation imprimee).
  // Doivent rester avant ':id'.
  @Get(':id/documents')
  listDocuments(@Param('id') id: string) {
    return this.service.listDocuments(id);
  }

  @Post(':id/documents')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: RECRUITMENT_UPLOAD.MAX_BYTES },
      fileFilter: cvFileFilter,
    }),
  )
  addDocument(
    @Param('id') id: string,
    @CurrentUser('employeeId') employeeId: string,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    return this.service.addDocument(id, file, employeeId);
  }

  @Delete(':id/documents/:attachmentId')
  removeDocument(
    @Param('id') id: string,
    @Param('attachmentId') attachmentId: string,
    @CurrentUser('employeeId') employeeId: string,
  ) {
    return this.service.removeDocument(id, attachmentId, employeeId);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateJobOfferDto,
    @CurrentUser('employeeId') employeeId: string,
  ) {
    return this.service.update(id, dto, employeeId);
  }

  @Post(':id/publish')
  publish(@Param('id') id: string, @CurrentUser('employeeId') employeeId: string) {
    return this.service.publish(id, employeeId);
  }

  @Post(':id/close')
  close(
    @Param('id') id: string,
    @Body() dto: CloseJobOfferDto,
    @CurrentUser('employeeId') employeeId: string,
  ) {
    return this.service.close(id, dto, employeeId);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser('employeeId') employeeId: string) {
    return this.service.remove(id, employeeId);
  }
}

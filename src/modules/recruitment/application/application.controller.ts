import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseFilters,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApplicationService } from './application.service';
import {
  CreateApplicationDto,
  UpdateApplicationDto,
  SetApplicationStatusDto,
  AddApplicationNoteDto,
  AddToTalentPoolDto,
  SelfApplyDto,
} from './dto/application.dto';
import { UploadApplicationDocumentDto } from '../attachments/dto/upload-document.dto';
import { RECRUITMENT_UPLOAD, cvFileFilter } from '../attachments/recruitment-upload.util';
import { RecruitmentUploadExceptionFilter } from '../attachments/recruitment-upload-exception.filter';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { RequirePermission } from '../../../common/decorators/require-permission.decorator';

const CV_UPLOAD_OPTS = {
  limits: { fileSize: RECRUITMENT_UPLOAD.MAX_BYTES },
  fileFilter: cvFileFilter,
};

@Controller('recruitment/applications')
@RequirePermission('RECRUTEMENT_ACCES')
@UseFilters(RecruitmentUploadExceptionFilter)
export class ApplicationController {
  constructor(private readonly service: ApplicationService) {}

  @Post()
  @UseInterceptors(FileInterceptor('cv', CV_UPLOAD_OPTS))
  create(
    @Body() dto: CreateApplicationDto,
    @CurrentUser('employeeId') employeeId: string,
    @UploadedFile() cv?: Express.Multer.File,
  ) {
    return this.service.create(dto, employeeId, cv);
  }

  @Get()
  findAll(@Query('source') source?: string, @Query('jobOfferId') jobOfferId?: string) {
    return this.service.findAll({ source, jobOfferId });
  }

  // Sous-routes documents (CV reel + pieces jointes). Doivent rester avant ':id'.
  @Get(':id/documents')
  listDocuments(@Param('id') id: string) {
    return this.service.listDocuments(id);
  }

  @Post(':id/documents')
  @UseInterceptors(FileInterceptor('file', CV_UPLOAD_OPTS))
  addDocument(
    @Param('id') id: string,
    @Body() dto: UploadApplicationDocumentDto,
    @CurrentUser('employeeId') employeeId: string,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    return this.service.addDocument(id, file, employeeId, dto.setPrimaryCv === 'true');
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
    @Body() dto: UpdateApplicationDto,
    @CurrentUser('employeeId') employeeId: string,
  ) {
    return this.service.update(id, dto, employeeId);
  }

  @Patch(':id/status')
  setStatus(
    @Param('id') id: string,
    @Body() dto: SetApplicationStatusDto,
    @CurrentUser('employeeId') employeeId: string,
  ) {
    return this.service.setStatus(id, dto, employeeId);
  }

  @Post(':id/notes')
  addNote(
    @Param('id') id: string,
    @Body() dto: AddApplicationNoteDto,
    @CurrentUser('employeeId') employeeId: string,
  ) {
    return this.service.addNote(id, dto, employeeId);
  }

  @Post(':id/talent-pool')
  addToTalentPool(
    @Param('id') id: string,
    @Body() dto: AddToTalentPoolDto,
    @CurrentUser('employeeId') employeeId: string,
  ) {
    return this.service.addToTalentPool(id, dto, employeeId);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser('employeeId') employeeId: string) {
    return this.service.remove(id, employeeId);
  }
}

// Cote espace employe (US12) : postuler en interne + suivre ses candidatures
// internes. Aucune permission recrutement requise — n'importe quel employe
// connecte peut postuler a une offre publiee.
@Controller('recruitment/my-applications')
export class MyApplicationsController {
  constructor(private readonly service: ApplicationService) {}

  // Doit rester avant ':id'.
  @Get('offers')
  publishedOffers() {
    return this.service.listPublishedOffersLite();
  }

  @Get()
  findMine(@CurrentUser('employeeId') employeeId: string) {
    return this.service.findMineInternal(employeeId);
  }

  @Post()
  selfApply(@Body() dto: SelfApplyDto, @CurrentUser('employeeId') employeeId: string) {
    return this.service.selfApply(dto.JobOfferId, employeeId);
  }

  @Delete(':id')
  withdraw(@Param('id') id: string, @CurrentUser('employeeId') employeeId: string) {
    return this.service.withdrawOwn(id, employeeId);
  }
}

import { BadRequestException, Body, Controller, Delete, Get, Param, Post, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import type { Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { AttachmentService } from './attachment.service';
import { UploadAttachmentDto, ATTACHMENT_ENTITY_TYPES, type AttachmentEntityType } from './dto/upload-attachment.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { CurrentPermissions } from '../../common/decorators/current-permissions.decorator';

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 Mo — largement suffisant pour un justificatif scanne/photo.

@Controller('attachments')
export class AttachmentController {
  constructor(private readonly service: AttachmentService) {}

  @Post()
  // defParamCharset utf8 : sans lui, multer lit le nom de fichier envoye par le
  // navigateur en latin1 et corrompt les accents ("certificat médical.pdf"
  // devenait "certificat mÃ©dical.pdf", nom stocke, affiche et joint aux emails).
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MAX_FILE_SIZE_BYTES }, defParamCharset: 'utf8' } as Record<string, unknown>),
  )
  upload(
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: UploadAttachmentDto,
    @CurrentUser('employeeId') employeeId: string,
    @CurrentPermissions() permissions: Set<string>,
  ) {
    if (!file) {
      throw new BadRequestException('Aucun fichier reçu');
    }
    return this.service.upload(dto.EntityType, dto.EntityId, file, employeeId, permissions);
  }

  @Get()
  findByEntity(
    @Query('entityType') entityType: AttachmentEntityType,
    @Query('entityId') entityId: string,
    @CurrentUser('employeeId') employeeId: string,
    @CurrentPermissions() permissions: Set<string>,
  ) {
    if (!ATTACHMENT_ENTITY_TYPES.includes(entityType)) {
      throw new BadRequestException("Le type d'entité indiqué est invalide");
    }
    return this.service.findByEntity(entityType, entityId, employeeId, permissions);
  }

  // Sert le contenu d'une piece jointe apres controle d'acces : indispensable pour
  // les fichiers du dossier du serveur (le navigateur ne peut pas les ouvrir par
  // lien direct). Le fichier est affiche dans le navigateur quand il sait le lire.
  @Get(':id/download')
  async download(
    @Param('id') id: string,
    @CurrentUser('employeeId') employeeId: string,
    @CurrentPermissions() permissions: Set<string>,
    @Res() res: Response,
  ) {
    const { buffer, fileName, mimeType } = await this.service.download(id, employeeId, permissions);
    res.setHeader('Content-Type', mimeType || 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(fileName)}`);
    res.setHeader('Content-Length', buffer.length);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.end(buffer);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser('employeeId') employeeId: string) {
    return this.service.remove(id, employeeId);
  }
}

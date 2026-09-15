import { Module } from '@nestjs/common';
import { AttachmentController } from './attachment.controller';
import { UploadsController } from './uploads.controller';
import { AttachmentService } from './attachment.service';
import { SharePointService } from './sharepoint.service';

@Module({
  controllers: [AttachmentController, UploadsController],
  providers: [AttachmentService, SharePointService],
  // SharePointService seul est exporte : le module Recrutement le reutilise
  // pour ses propres depots (CV du portail public, pieces jointes d'offre)
  // sans passer par AttachmentService, dont le controle d'acces suppose un
  // employe proprietaire (un candidat n'en est pas un).
  exports: [SharePointService],
})
export class AttachmentModule {}

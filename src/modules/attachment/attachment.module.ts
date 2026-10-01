import { Module } from '@nestjs/common';
import { AttachmentController } from './attachment.controller';
import { UploadsController } from './uploads.controller';
import { AttachmentService } from './attachment.service';
import { SharePointService } from './sharepoint.service';

@Module({
  controllers: [AttachmentController, UploadsController],
  providers: [AttachmentService, SharePointService],
  // AttachmentService : exporte pour que les notifications puissent joindre
  // les justificatifs aux emails de validation (voir WorkflowNotifierService).
  // SharePointService : exporte pour que le module Recrutement l'utilise
  // directement pour ses propres depots (CV du portail public, pieces
  // jointes d'offre), sans passer par AttachmentService dont le controle
  // d'acces suppose un employe proprietaire (un candidat n'en est pas un).
  exports: [AttachmentService, SharePointService],
})
export class AttachmentModule {}

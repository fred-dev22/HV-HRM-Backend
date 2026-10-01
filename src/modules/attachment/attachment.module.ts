import { Module } from '@nestjs/common';
import { AttachmentController } from './attachment.controller';
import { UploadsController } from './uploads.controller';
import { AttachmentService } from './attachment.service';
import { SharePointService } from './sharepoint.service';

@Module({
  controllers: [AttachmentController, UploadsController],
  providers: [AttachmentService, SharePointService],
  // Exporte pour que les notifications puissent joindre les justificatifs
  // aux emails de validation (voir WorkflowNotifierService).
  exports: [AttachmentService],
})
export class AttachmentModule {}

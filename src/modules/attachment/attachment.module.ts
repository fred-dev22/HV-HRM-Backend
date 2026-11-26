import { Module } from '@nestjs/common';
import { AttachmentController } from './attachment.controller';
import { LocalStorageService } from './local-storage.service';
import { AttachmentService } from './attachment.service';
import { SharePointService } from './sharepoint.service';
import { StorageSettingsController } from './storage-settings.controller';
import { StorageSettingsService } from './storage-settings.service';

@Module({
  controllers: [AttachmentController, StorageSettingsController],
  providers: [AttachmentService, SharePointService, LocalStorageService, StorageSettingsService],
  // AttachmentService : exporte pour que les notifications joignent les
  // justificatifs aux emails de validation (voir WorkflowNotifierService) et pour
  // que le Recrutement depose ses CV et pieces jointes d'offre au meme endroit.
  exports: [AttachmentService, StorageSettingsService],
})
export class AttachmentModule {}

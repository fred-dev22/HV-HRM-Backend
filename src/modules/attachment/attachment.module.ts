import { Module } from '@nestjs/common';
import { AttachmentController } from './attachment.controller';
import { AttachmentService } from './attachment.service';
import { SharePointService } from './sharepoint.service';

@Module({
  controllers: [AttachmentController],
  providers: [AttachmentService, SharePointService],
})
export class AttachmentModule {}

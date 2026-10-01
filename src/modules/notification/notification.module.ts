import { Module } from '@nestjs/common';
import { NotificationController } from './notification.controller';
import { NotificationService } from './notification.service';
import { WorkflowNotifierService } from './workflow-notifier.service';
import { MailModule } from '../mail/mail.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { AttachmentModule } from '../attachment/attachment.module';

@Module({
  imports: [MailModule, RealtimeModule, AttachmentModule],
  controllers: [NotificationController],
  providers: [NotificationService, WorkflowNotifierService],
  exports: [NotificationService, WorkflowNotifierService],
})
export class NotificationModule {}

import { Module } from '@nestjs/common';
import { NotificationController } from './notification.controller';
import { NotificationService } from './notification.service';
import { WorkflowNotifierService } from './workflow-notifier.service';
import { MailModule } from '../mail/mail.module';
import { RealtimeModule } from '../realtime/realtime.module';

@Module({
  imports: [MailModule, RealtimeModule],
  controllers: [NotificationController],
  providers: [NotificationService, WorkflowNotifierService],
  exports: [NotificationService, WorkflowNotifierService],
})
export class NotificationModule {}

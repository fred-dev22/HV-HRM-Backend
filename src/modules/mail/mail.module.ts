import { Module } from '@nestjs/common';
import { MailService } from './mail.service';
import { MailSettingsService } from './mail-settings.service';
import { MailSettingsController } from './mail-settings.controller';

@Module({
  controllers: [MailSettingsController],
  providers: [MailService, MailSettingsService],
  exports: [MailService, MailSettingsService],
})
export class MailModule {}

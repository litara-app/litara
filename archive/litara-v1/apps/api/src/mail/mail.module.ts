import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { SmtpConfigService } from './smtp-config.service';
import { MailService } from './mail.service';
import { SmtpSettingsController } from './smtp-settings.controller';
import { UserSmtpController } from './user-smtp.controller';
import { RecipientEmailService } from './recipient-email.service';
import { RecipientEmailController } from './recipient-email.controller';

@Module({
  imports: [DatabaseModule],
  controllers: [
    SmtpSettingsController,
    UserSmtpController,
    RecipientEmailController,
  ],
  providers: [SmtpConfigService, MailService, RecipientEmailService],
  exports: [MailService, SmtpConfigService],
})
export class MailModule {}

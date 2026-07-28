import { Global, Module } from '@nestjs/common';
import { MessagingService } from './messaging.service';
import { SmsService } from './sms.service';
import { PostmarkService } from './postmark.service';
import { SuppressionService } from './suppression.service';
import { EmailDispatchService } from './email-dispatch.service';
import { PostmarkWebhookController } from './postmark-webhook.controller';

@Global()
@Module({
  controllers: [PostmarkWebhookController],
  providers: [MessagingService, SmsService, PostmarkService, SuppressionService, EmailDispatchService],
  exports:   [MessagingService, SmsService, SuppressionService],
})
export class MessagingModule {}

import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { MailerModule } from '@nestjs-modules/mailer';
import { HandlebarsAdapter } from '@nestjs-modules/mailer/adapters/handlebars.adapter';
import { HttpModule } from '@nestjs/axios';
import { join } from 'path';
import { EmailLog } from './email-log.entity';
import { EmailService } from './email.service';
import { EmailProcessor } from './email.processor';
import { EmailNotificationService } from './email-notification.service';
import { EmailSuppression } from './email-suppression.entity';
import { EmailEventsService } from './email-events/email-events.service';
import { EmailEventsController } from './email-events/email-events.controller';
import { AdminEmailSuppressionsController } from './email-events/admin-email-suppressions.controller';
import { InAppNotification } from './in-app-notification.entity';
import { InAppNotificationsService } from './in-app-notifications.service';
import { InAppNotificationsController } from './in-app-notifications.controller';
import { NotificationPreference } from './notification-preference.entity';
import { NotificationPreferencesService } from './notification-preferences.service';
import { NotificationPreferencesController } from './notification-preferences.controller';
import { SlackNotificationService } from './slack-notification.service';
import { PhoneVerification } from './phone-verification.entity';
import { SmsNotificationService } from './sms-notification.service';
import { PhoneVerificationController } from './phone-verification.controller';
import { TwilioSmsProvider } from './providers/twilio-sms.provider';
import { MockSmsProvider } from './providers/mock-sms.provider';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      EmailLog,
      EmailSuppression,
      InAppNotification,
      NotificationPreference,
      PhoneVerification,
    ]),
    BullModule.registerQueue({
      name: 'emails',
    }),
    HttpModule,
    MailerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        transport: {
          host: config.get<string>('SMTP_HOST', 'smtp.ethereal.email'),
          port: config.get<number>('SMTP_PORT', 587),
          secure: config.get<string>('SMTP_SECURE', 'false') === 'true',
          auth: {
            user: config.get<string>('SMTP_USER', ''),
            pass: config.get<string>('SMTP_PASS', ''),
          },
        },
        defaults: {
          from: config.get<string>(
            'SMTP_FROM',
            '"FacilPay" <noreply@facilpay.com>',
          ),
        },
        template: {
          dir: join(__dirname, 'templates'),
          adapter: new HandlebarsAdapter(),
          options: {
            strict: true,
          },
        },
      }),
    }),
  ],
  controllers: [
    EmailEventsController,
    AdminEmailSuppressionsController,
    InAppNotificationsController,
    NotificationPreferencesController,
    PhoneVerificationController,
  ],
  providers: [
    EmailService,
    EmailProcessor,
    EmailNotificationService,
    EmailEventsService,
    InAppNotificationsService,
    NotificationPreferencesService,
    SlackNotificationService,
    SmsNotificationService,
    {
      provide: 'SMS_PROVIDER',
      useFactory: (configService: ConfigService) => {
        const useMock = configService.get<string>('SMS_PROVIDER') === 'mock';
        return useMock
          ? new MockSmsProvider()
          : new TwilioSmsProvider(configService);
      },
      inject: [ConfigService],
    },
  ],
  exports: [
    EmailService,
    EmailNotificationService,
    EmailEventsService,
    InAppNotificationsService,
    NotificationPreferencesService,
    SlackNotificationService,
    SmsNotificationService,
  ],
})
export class NotificationsModule {}

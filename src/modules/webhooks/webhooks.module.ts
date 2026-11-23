import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HttpModule } from '@nestjs/axios';
import { BullModule } from '@nestjs/bullmq';
import { WebhookEndpoint } from './entities/webhook-endpoint.entity';
import { WebhookDelivery } from './entities/webhook-delivery.entity';
import { WebhookReplay } from './entities/webhook-replay.entity';
import { WebhooksService } from './webhooks.service';
import { WebhooksController } from './webhooks.controller';
import { WebhooksProcessor } from './webhooks.processor';
import { NotificationsModule } from '../notifications/notifications.module';
import { UsersModule } from '../users/users.module';
import { ApiKeysModule } from '../api-keys/api-keys.module';
import { Event } from '../events/entities/event.entity';
import { HooksController } from './hooks.controller';
import { HooksService } from './hooks.service';
import { AwsDestinationService } from './aws-destination.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([WebhookEndpoint, WebhookDelivery, WebhookReplay, Event]),
    ApiKeysModule,
    HttpModule,
    BullModule.registerQueue({
      name: 'webhooks',
    }),
    NotificationsModule,
    UsersModule,
  ],
  controllers: [WebhooksController, HooksController],
  providers: [WebhooksService, WebhooksProcessor, HooksService, AwsDestinationService],
  exports: [WebhooksService],
})
export class WebhooksModule {}

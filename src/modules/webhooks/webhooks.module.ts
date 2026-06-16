import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WebhookDelivery } from './webhook-delivery.entity';
import { WebhookRetryService } from './webhook-retry.service';
import { WebhookDeliveriesController } from './webhook-deliveries.controller';

@Module({
  imports: [TypeOrmModule.forFeature([WebhookDelivery])],
  controllers: [WebhookDeliveriesController],
  providers: [WebhookRetryService],
  exports: [WebhookRetryService],
})
export class WebhooksModule {}

import { PickType } from '@nestjs/swagger';
import { CreateWebhookEndpointDto } from './create-webhook-endpoint.dto';

export class SubscribeHookDto extends PickType(CreateWebhookEndpointDto, ['url', 'events', 'apiVersion'] as const) {}

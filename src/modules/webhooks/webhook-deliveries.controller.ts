import { Controller, Get, Param, Post, HttpCode, HttpStatus } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiParam,
  ApiOkResponse,
  ApiNotFoundResponse,
} from '@nestjs/swagger';
import { WebhookRetryService } from './webhook-retry.service';

@ApiTags('webhooks')
@Controller('v1/webhooks')
export class WebhookDeliveriesController {
  constructor(private readonly webhookRetryService: WebhookRetryService) {}

  @Get('deliveries/:paymentId')
  @ApiOperation({
    summary: 'List webhook deliveries for a payment',
    description:
      'Returns all outbound webhook delivery attempts for a given payment, including retry history.',
  })
  @ApiParam({ name: 'paymentId', description: 'Payment UUID' })
  @ApiOkResponse({ description: 'List of webhook deliveries.' })
  getDeliveries(@Param('paymentId') paymentId: string) {
    return this.webhookRetryService.getDeliveries(paymentId);
  }

  @Post('retry-pending')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Manually trigger retry of pending webhook deliveries',
    description:
      'Picks up all failed webhook deliveries whose next retry time has passed and attempts redelivery.',
  })
  @ApiOkResponse({ description: 'Retry sweep triggered.' })
  async retryPending() {
    await this.webhookRetryService.retryPendingDeliveries();
    return { message: 'Retry sweep completed' };
  }
}

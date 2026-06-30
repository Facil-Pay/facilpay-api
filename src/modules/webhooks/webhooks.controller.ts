import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiBody,
  ApiParam,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiForbiddenResponse,
  ApiUnauthorizedResponse,
  ApiBadRequestResponse,
  ApiInternalServerErrorResponse,
  ApiResponse,
} from '@nestjs/swagger';
import { WebhooksService } from './webhooks.service';
import { CreateWebhookEndpointDto } from './dto/create-webhook-endpoint.dto';
import { UpdateWebhookEndpointDto } from './dto/update-webhook-endpoint.dto';
import { WebhookEndpoint, WEBHOOK_EVENT_TYPES } from './entities/webhook-endpoint.entity';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '../users/user.entity';

@ApiTags('webhooks')
@ApiBearerAuth('bearer')
@UseGuards(JwtAuthGuard)
@Controller('v1/webhooks')
export class WebhooksController {
  constructor(private readonly webhooksService: WebhooksService) {}

  @Post()
  @ApiOperation({
    summary: 'Register a webhook endpoint',
    description:
      'Registers a new webhook URL and returns it with a generated signing secret. ' +
      'Use the secret to verify incoming payloads by checking the `X-FacilPay-Signature` header ' +
      '(HMAC-SHA256 of the raw JSON body keyed with the secret).\n\n' +
      `**Supported events:** ${WEBHOOK_EVENT_TYPES.join(', ')}`,
  })
  @ApiBody({ type: CreateWebhookEndpointDto })
  @ApiCreatedResponse({
    description: 'Webhook endpoint registered.',
    type: WebhookEndpoint,
    schema: {
      example: {
        id: '123e4567-e89b-12d3-a456-426614174000',
        merchantId: 'abc123',
        url: 'https://merchant.example.com/webhooks',
        events: ['payment.created', 'payment.completed'],
        isActive: true,
        secret: 'whsec_abc123...',
        createdAt: '2026-01-26T10:00:00.000Z',
        updatedAt: '2026-01-26T10:00:00.000Z',
      },
    },
  })
  @ApiBadRequestResponse({
    description: 'Validation failed (invalid URL or unknown event type).',
    schema: {
      example: {
        statusCode: 400,
        message: ['url must be a valid HTTPS URL', 'Each event must be one of: payment.created, ...'],
        error: 'Bad Request',
      },
    },
  })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid JWT.' })
  @ApiInternalServerErrorResponse({ description: 'Internal server error.' })
  create(
    @Body() dto: CreateWebhookEndpointDto,
    @CurrentUser() user: User,
  ): Promise<WebhookEndpoint> {
    return this.webhooksService.create(dto, user.id);
  }

  @Get()
  @ApiOperation({
    summary: 'List registered webhook endpoints',
    description: "Returns all webhook endpoints belonging to the authenticated merchant.",
  })
  @ApiOkResponse({
    description: 'List of webhook endpoints.',
    type: [WebhookEndpoint],
    schema: {
      example: [
        {
          id: '123e4567-e89b-12d3-a456-426614174000',
          merchantId: 'abc123',
          url: 'https://merchant.example.com/webhooks',
          events: ['payment.created', 'payment.completed'],
          isActive: true,
          secret: 'whsec_abc123...',
          createdAt: '2026-01-26T10:00:00.000Z',
          updatedAt: '2026-01-26T10:00:00.000Z',
        },
      ],
    },
  })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid JWT.' })
  findAll(@CurrentUser() user: User): Promise<WebhookEndpoint[]> {
    return this.webhooksService.findAll(user.id);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Update a webhook endpoint',
    description: 'Update the URL, event subscriptions, or active status of an existing endpoint. Only the owning merchant may update.',
  })
  @ApiParam({ name: 'id', description: 'Webhook endpoint UUID', example: '123e4567-e89b-12d3-a456-426614174000' })
  @ApiBody({ type: UpdateWebhookEndpointDto })
  @ApiOkResponse({
    description: 'Webhook endpoint updated.',
    type: WebhookEndpoint,
    schema: {
      example: {
        id: '123e4567-e89b-12d3-a456-426614174000',
        merchantId: 'abc123',
        url: 'https://merchant.example.com/webhooks/v2',
        events: ['payment.completed', 'refund.issued'],
        isActive: true,
        secret: 'whsec_abc123...',
        createdAt: '2026-01-26T10:00:00.000Z',
        updatedAt: '2026-01-26T11:00:00.000Z',
      },
    },
  })
  @ApiBadRequestResponse({
    description: 'Validation failed.',
    schema: {
      example: { statusCode: 400, message: ['url must be a valid HTTPS URL'], error: 'Bad Request' },
    },
  })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid JWT.' })
  @ApiForbiddenResponse({
    description: 'Endpoint belongs to a different merchant.',
    schema: { example: { statusCode: 403, message: 'Forbidden', error: 'Forbidden' } },
  })
  @ApiNotFoundResponse({
    description: 'Webhook endpoint not found.',
    schema: {
      example: {
        statusCode: 404,
        message: 'Webhook endpoint 123e4567-e89b-12d3-a456-426614174000 not found',
        error: 'Not Found',
      },
    },
  })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateWebhookEndpointDto,
    @CurrentUser() user: User,
  ): Promise<WebhookEndpoint> {
    return this.webhooksService.update(id, dto, user.id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete a webhook endpoint',
    description: 'Permanently removes the webhook endpoint. Only the owning merchant may delete.',
  })
  @ApiParam({ name: 'id', description: 'Webhook endpoint UUID', example: '123e4567-e89b-12d3-a456-426614174000' })
  @ApiNoContentResponse({ description: 'Webhook endpoint deleted.' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid JWT.' })
  @ApiForbiddenResponse({
    description: 'Endpoint belongs to a different merchant.',
    schema: { example: { statusCode: 403, message: 'Forbidden', error: 'Forbidden' } },
  })
  @ApiNotFoundResponse({
    description: 'Webhook endpoint not found.',
    schema: {
      example: {
        statusCode: 404,
        message: 'Webhook endpoint 123e4567-e89b-12d3-a456-426614174000 not found',
        error: 'Not Found',
      },
    },
  })
  async remove(@Param('id') id: string, @CurrentUser() user: User): Promise<void> {
    return this.webhooksService.remove(id, user.id);
  }

  @Post(':id/test')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Send a test event to a webhook endpoint',
    description:
      'Fires a `test` event to the registered URL with a sample payload. ' +
      'The request includes an `X-FacilPay-Signature` header (HMAC-SHA256) so you can verify ' +
      'your signature-checking logic. Returns whether delivery succeeded.',
  })
  @ApiParam({ name: 'id', description: 'Webhook endpoint UUID', example: '123e4567-e89b-12d3-a456-426614174000' })
  @ApiOkResponse({
    description: 'Test event fired (check `delivered` to see if the endpoint responded successfully).',
    schema: {
      example: {
        delivered: true,
        statusCode: 200,
        error: null,
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Test event fired but endpoint returned an error.',
    schema: {
      example: {
        delivered: false,
        statusCode: 500,
        error: 'connect ECONNREFUSED 127.0.0.1:4000',
      },
    },
  })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid JWT.' })
  @ApiForbiddenResponse({
    description: 'Endpoint belongs to a different merchant.',
    schema: { example: { statusCode: 403, message: 'Forbidden', error: 'Forbidden' } },
  })
  @ApiNotFoundResponse({
    description: 'Webhook endpoint not found.',
    schema: {
      example: {
        statusCode: 404,
        message: 'Webhook endpoint 123e4567-e89b-12d3-a456-426614174000 not found',
        error: 'Not Found',
      },
    },
  })
  sendTest(
    @Param('id') id: string,
    @CurrentUser() user: User,
  ): Promise<{ delivered: boolean; statusCode: number | null; error: string | null }> {
    return this.webhooksService.sendTest(id, user.id);
  }

  @Post('deliveries/:deliveryId/retry')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Manually retry a failed webhook delivery',
    description: 'Enqueues a failed or dead-lettered webhook delivery for manual retry.',
  })
  @ApiParam({ name: 'deliveryId', description: 'Webhook delivery UUID', example: '123e4567-e89b-12d3-a456-426614174000' })
  @ApiOkResponse({
    description: 'Webhook delivery scheduled for manual retry.',
  })
  @ApiForbiddenResponse({
    description: 'Delivery is not failed or dead-lettered.',
  })
  @ApiNotFoundResponse({
    description: 'Webhook delivery not found.',
  })
  async retryFailedDelivery(@Param('deliveryId') deliveryId: string): Promise<void> {
    return this.webhooksService.retryFailedDelivery(deliveryId);
  }
}

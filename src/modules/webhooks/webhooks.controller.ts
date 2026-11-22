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
  Query,
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
import { maskEndpoint } from './header-security';
import { WebhooksService } from './webhooks.service';
import { CreateWebhookEndpointDto } from './dto/create-webhook-endpoint.dto';
import { UpdateWebhookEndpointDto } from './dto/update-webhook-endpoint.dto';
import { WebhookEndpoint, WEBHOOK_EVENT_TYPES } from './entities/webhook-endpoint.entity';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '../users/user.entity';
import { EmailNotificationService } from '../notifications/email-notification.service';
import { ConfigService } from '@nestjs/config';
import { ReplayWebhooksDto } from './dto/replay-webhooks.dto';
import { ListWebhookDeliveriesDto } from './dto/list-webhook-deliveries.dto';
import { RotateWebhookSecretDto } from './dto/rotate-webhook-secret.dto';

@ApiTags('webhooks')
@ApiBearerAuth('bearer')
@UseGuards(JwtAuthGuard)
@Controller('v1/webhooks')
export class WebhooksController {
  constructor(
    private readonly webhooksService: WebhooksService,
    private readonly emailNotificationService: EmailNotificationService,
    private readonly configService: ConfigService,
  ) { }

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
    return this.webhooksService.create(dto, user.id).then(maskEndpoint);
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
    return this.webhooksService.findAll(user.id).then(endpoints => endpoints.map(maskEndpoint));
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
    return this.webhooksService.update(id, dto, user.id).then(maskEndpoint);
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

  @Post(':id/rotate-secret')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Rotate the signing secret for a webhook endpoint',
    description:
      'Generates a new signing secret for an existing webhook endpoint. For a grace period (default 24 hours, ' +
      'set `gracePeriodHours` between 0 and 168) deliveries are signed with both the new and the previous secret: ' +
      '`X-FacilPay-Signature` then holds two comma-separated digests, new secret first, and receivers should accept ' +
      'the delivery if any of them verifies. Send `gracePeriodHours: 0` to switch secrets immediately. ' +
      'The new secret is returned exactly once in this response — store it securely, as it cannot be retrieved again.',
  })
  @ApiParam({ name: 'id', description: 'Webhook endpoint UUID', example: '123e4567-e89b-12d3-a456-426614174000' })
  @ApiBody({ type: RotateWebhookSecretDto, required: false })
  @ApiOkResponse({
    description: 'Signing secret rotated.',
    type: WebhookEndpoint,
    schema: {
      example: {
        id: '123e4567-e89b-12d3-a456-426614174000',
        merchantId: 'abc123',
        url: 'https://merchant.example.com/webhooks',
        events: ['payment.created', 'payment.completed'],
        isActive: true,
        secret: 'whsec_newsecret123...',
        previousSecret: '********',
        previousSecretExpiresAt: '2026-01-27T12:00:00.000Z',
        createdAt: '2026-01-26T10:00:00.000Z',
        updatedAt: '2026-01-26T12:00:00.000Z',
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
  rotateSecret(
    @Param('id') id: string,
    @Body() dto: RotateWebhookSecretDto,
    @CurrentUser() user: User,
  ): Promise<WebhookEndpoint> {
    return this.webhooksService
      .rotateSecret(id, user.id, dto?.gracePeriodHours)
      .then(maskEndpoint);
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
    description: 'Delivery is not failed or dead-lettered, or belongs to a different merchant.',
  })
  @ApiNotFoundResponse({
    description: 'Webhook delivery not found.',
  })
  async retryFailedDelivery(
    @Param('deliveryId') deliveryId: string,
    @CurrentUser() user: User,
  ): Promise<void> {
    return this.webhooksService.retryFailedDelivery(deliveryId, user.id);
  }

  @Post(':id/replay')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Replay webhook events in a time range',
    description:
      'Queues matching events in chronological order. Replay windows are limited to 7 days and 10000 events.',
  })
  @ApiParam({ name: 'id', description: 'Webhook endpoint UUID' })
  @ApiBody({ type: ReplayWebhooksDto })
  @ApiResponse({ status: HttpStatus.ACCEPTED, description: 'Replay queued.' })
  @ApiBadRequestResponse({ description: 'Invalid replay window or event limit exceeded.' })
  @ApiNotFoundResponse({ description: 'Webhook endpoint not found.' })
  @ApiForbiddenResponse({ description: 'Endpoint belongs to a different merchant.' })
  replay(
    @Param('id') id: string,
    @Body() dto: ReplayWebhooksDto,
    @CurrentUser() user: User,
  ) {
    return this.webhooksService.replayEvents(id, user.id, dto);
  }

  @Get('replays/:jobId')
  @ApiOperation({ summary: 'Get webhook replay progress' })
  @ApiParam({ name: 'jobId', description: 'Replay job UUID' })
  @ApiOkResponse({ description: 'Current replay progress.' })
  @ApiNotFoundResponse({ description: 'Replay job not found.' })
  @ApiForbiddenResponse({ description: 'Replay belongs to a different merchant.' })
  getReplayProgress(
    @Param('jobId') jobId: string,
    @CurrentUser() user: User,
  ) {
    return this.webhooksService.getReplayProgress(jobId, user.id);
  }

  @Get(':id/stats')
  @ApiOperation({ summary: 'Delivery health over 24 hours and 7 days', description: 'Success rate is a fraction of attempted deliveries. Latencies are milliseconds for the latest attempt per delivery; pending deliveries are excluded. Cached for 60 seconds.' })
  getStats(@Param('id') id: string, @CurrentUser() user: User) {
    return this.webhooksService.getStats(id, user.id);
  }

  @Get(':id/deliveries')
  @ApiOperation({
    summary: 'List delivery attempts for a webhook endpoint',
    description:
      "Returns the endpoint's deliveries, newest first, with status, attempts, response code, latency, event type " +
      'and the first 1024 characters of the latest response body. Filter by `status`, `eventType`, `from` and `to`.',
  })
  @ApiParam({
    name: 'id',
    description: 'Webhook endpoint UUID',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @ApiOkResponse({
    description: 'Paginated deliveries.',
    schema: {
      example: {
        data: [
          {
            id: '5f0c7a3e-6b52-4f4e-9d3b-0d6f1c2f9a10',
            eventType: 'payment.completed',
            status: 'failed',
            attempts: 2,
            responseCode: 500,
            latencyMs: 182,
            responseBody: '{"error":"upstream timeout"}',
            error: 'Request failed with status code 500',
            lastAttemptAt: '2026-01-26T10:00:05.000Z',
            createdAt: '2026-01-26T10:00:00.000Z',
          },
        ],
        total: 1,
        page: 1,
        limit: 20,
      },
    },
  })
  @ApiBadRequestResponse({
    description: 'Invalid filter, or `from` is after `to`.',
  })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid JWT.' })
  @ApiForbiddenResponse({
    description: 'Endpoint belongs to a different merchant.',
  })
  @ApiNotFoundResponse({ description: 'Webhook endpoint not found.' })
  listDeliveries(
    @Param('id') id: string,
    @Query() dto: ListWebhookDeliveriesDto,
    @CurrentUser() user: User,
  ) {
    return this.webhooksService.listDeliveries(id, user.id, dto);
  }

  @Post(':id/enable')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Re-enable a disabled webhook endpoint',
    description: 'Re-enables a webhook endpoint that was disabled due to too many failures. Resets failure counters.',
  })
  @ApiParam({ name: 'id', description: 'Webhook endpoint UUID', example: '123e4567-e89b-12d3-a456-426614174000' })
  @ApiOkResponse({
    description: 'Webhook endpoint re-enabled.',
    type: WebhookEndpoint,
  })
  @ApiForbiddenResponse({
    description: 'Endpoint belongs to a different merchant.',
  })
  @ApiNotFoundResponse({
    description: 'Webhook endpoint not found.',
  })
  async reenable(
    @Param('id') id: string,
    @CurrentUser() user: User,
  ): Promise<WebhookEndpoint> {
    return this.webhooksService.reenableEndpoint(id, user.id).then(maskEndpoint);
  }
}

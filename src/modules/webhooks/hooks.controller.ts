import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse, ApiOperation, ApiParam, ApiQuery, ApiSecurity, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { ApiKeyAuthGuard } from '../api-keys/api-key-auth.guard';
import { RequireScope } from '../api-keys/decorators/require-scope.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { SubscribeHookDto } from './dto/subscribe-hook.dto';
import { WebhooksService } from './webhooks.service';
import { HooksService } from './hooks.service';
import { maskEndpoint } from './header-security';
import { WEBHOOK_EVENT_TYPES } from './entities/webhook-endpoint.entity';
import { SUPPORTED_API_VERSIONS } from './payload-serializers';

@ApiTags('hooks')
@ApiSecurity('api-key')
@ApiUnauthorizedResponse({ description: 'Missing, expired or invalid API key or OAuth access token' })
@UseGuards(ApiKeyAuthGuard)
@Controller('v1/hooks')
export class HooksController {
  constructor(private readonly webhooks: WebhooksService, private readonly hooks: HooksService) {}

  @Post('subscribe')
  @RequireScope('webhooks:write')
  @ApiOperation({ summary: 'Subscribe a REST hook to events', description: 'Reuses webhook filters, payload versions, retries and logs; HTTP 410 automatically unsubscribes.' })
  @ApiCreatedResponse({ description: 'Subscription created; use the returned id to unsubscribe' })
  async subscribe(@CurrentUser() user: { id: string }, @Body() dto: SubscribeHookDto) {
    return maskEndpoint(await this.webhooks.subscribe(dto, user.id));
  }

  @Delete(':id')
  @HttpCode(204)
  @RequireScope('webhooks:write')
  @ApiOperation({ summary: 'Unsubscribe a REST hook' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiNoContentResponse({ description: 'Subscription removed' })
  unsubscribe(@CurrentUser() user: { id: string }, @Param('id', ParseUUIDPipe) id: string) {
    return this.webhooks.unsubscribe(id, user.id);
  }

  @Get('samples/:eventType')
  @RequireScope('webhooks:read')
  @ApiOperation({ summary: 'Poll recent merchant events or get a trigger setup sample', description: 'Up to 20 events, newest first. Stable id supports trigger deduplication. With no history, returns a sample marked sample:true in data.' })
  @ApiParam({ name: 'eventType', enum: WEBHOOK_EVENT_TYPES })
  @ApiQuery({ name: 'apiVersion', required: false, enum: SUPPORTED_API_VERSIONS })
  @ApiOkResponse({ description: 'Versioned event payloads with stable IDs' })
  samples(@CurrentUser() user: { id: string }, @Param('eventType') type: string, @Query('apiVersion') version?: string) {
    return this.hooks.samples(user.id, type, version);
  }
}

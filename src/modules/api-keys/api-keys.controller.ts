import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ApiKeysService } from './api-keys.service';
import { CreateApiKeyDto } from './dto/create-api-key.dto';
import { UpdateApiKeyDto } from './dto/update-api-key.dto';
import { GetApiKeyUsageDto } from './dto/get-api-key-usage.dto';
import { ApiKey } from './api-key.entity';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '../users/user.entity';

@ApiTags('api-keys')
@ApiBearerAuth('bearer')
@UseGuards(JwtAuthGuard)
@Controller('v1/api-keys')
export class ApiKeysController {
  constructor(private readonly apiKeysService: ApiKeysService) {}

  @Post()
  @ApiOperation({
    summary: 'Create a new API key',
    description:
      'Creates a new API key for programmatic access. The full key is returned only once — store it securely.',
  })
  @ApiCreatedResponse({
    description: 'API key created. Plaintext key shown only once.',
    schema: {
      example: {
        apiKey: {
          id: '550e8400-e29b-41d4-a716-446655440000',
          name: 'My integration',
          keyPrefix: 'fp_live_xxxx',
          scope: 'read',
          environment: 'live',
          expiresAt: null,
          lastUsedAt: null,
          isActive: true,
          createdAt: '2026-06-28T10:00:00.000Z',
        },
        plaintext: 'fp_live_abc123...',
      },
    },
  })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid bearer token.' })
  async create(
    @CurrentUser() user: User,
    @Body() dto: CreateApiKeyDto,
  ): Promise<{ apiKey: ApiKey; plaintext: string }> {
    return this.apiKeysService.create(user.id, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List all active API keys for the current user' })
  @ApiOkResponse({
    description: 'List of active API keys (key hashes never returned).',
    type: [ApiKey],
  })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid bearer token.' })
  async findAll(@CurrentUser() user: User): Promise<ApiKey[]> {
    return this.apiKeysService.findAllForUser(user.id);
  }

  @Patch(':id')
  @ApiOperation({
    summary: "Update an API key's name, scope, and/or rate limit override",
    description:
      'Updates the name, scope, and/or custom rate limit of an existing API key without regenerating its secret. Changes take effect immediately for subsequent requests.',
  })
  @ApiBody({ type: UpdateApiKeyDto })
  @ApiOkResponse({ description: 'API key updated.', type: ApiKey })
  @ApiNotFoundResponse({ description: 'API key not found.' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid bearer token.' })
  async update(
    @Param('id') id: string,
    @CurrentUser() user: User,
    @Body() dto: UpdateApiKeyDto,
  ): Promise<ApiKey> {
    return this.apiKeysService.update(id, user.id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoke an API key' })
  @ApiNoContentResponse({ description: 'API key revoked.' })
  @ApiNotFoundResponse({ description: 'API key not found.' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid bearer token.' })
  async revoke(
    @Param('id') id: string,
    @CurrentUser() user: User,
  ): Promise<void> {
    return this.apiKeysService.revoke(id, user.id);
  }

  @Post(':id/rotate')
  @ApiOperation({
    summary: 'Rotate an API key',
    description:
      'Revokes the current API key and creates a new one with the same name, scope, and environment settings. The new plaintext key is returned only once — store it securely.',
  })
  @ApiOkResponse({
    description: 'API key rotated. New plaintext key shown only once.',
    schema: {
      example: {
        apiKey: {
          id: '660e8400-e29b-41d4-a716-446655440001',
          name: 'My integration',
          keyPrefix: 'fp_live_yyyy',
          scope: 'read',
          environment: 'live',
          expiresAt: null,
          lastUsedAt: null,
          isActive: true,
          createdAt: '2026-06-28T11:00:00.000Z',
        },
        plaintext: 'fp_live_xyz789...',
      },
    },
  })
  @ApiNotFoundResponse({ description: 'API key not found.' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid bearer token.' })
  async rotate(
    @Param('id') id: string,
    @CurrentUser() user: User,
  ): Promise<{ apiKey: ApiKey; plaintext: string }> {
    return this.apiKeysService.rotate(id, user.id);
  }

  @Get(':id/usage')
  @ApiOperation({
    summary: 'Get API key usage history',
    description:
      'Returns a paginated list of recent usage records for a specific API key, including endpoint, source IP, and timestamp for each authenticated request.',
  })
  @ApiParam({
    name: 'id',
    description: 'API key UUID',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @ApiOkResponse({
    description: 'List of usage records.',
    schema: {
      example: {
        data: [
          {
            id: 'usage-uuid-1',
            apiKeyId: '550e8400-e29b-41d4-a716-446655440000',
            endpoint: '/v1/payments',
            method: 'POST',
            sourceIp: '192.168.1.1',
            userAgent: 'Mozilla/5.0...',
            statusCode: 201,
            createdAt: '2026-07-28T10:00:00.000Z',
          },
        ],
        total: 150,
        page: 1,
        limit: 20,
      },
    },
  })
  @ApiNotFoundResponse({ description: 'API key not found.' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid bearer token.' })
  async getUsageHistory(
    @Param('id') id: string,
    @CurrentUser() user: User,
    @Query() dto: GetApiKeyUsageDto,
  ) {
    return this.apiKeysService.getUsageHistory(id, user.id, dto);
  }
}

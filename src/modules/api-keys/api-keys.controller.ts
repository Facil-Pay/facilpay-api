import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ApiKeysService } from './api-keys.service';
import { CreateApiKeyDto } from './dto/create-api-key.dto';
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
}

import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../../common/constants/roles';
import { WebhookSigningKeysService } from './webhook-signing-keys.service';
import { RotateSigningKeyDto } from './dto/rotate-signing-key.dto';

const PUBLIC_KEYS_EXAMPLE = {
  keys: [
    {
      kid: 'whk_3f9a1c2b7d4e5f60',
      algorithm: 'ed25519',
      status: 'active',
      publicKey: '11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo',
      publicKeyPem:
        '-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEA11qYAYKxCrfVS/7TyWQHOg7hcvPapiMlrwIaaPcHURo=\n-----END PUBLIC KEY-----\n',
      createdAt: '2026-11-20T10:00:00.000Z',
      expiresAt: null,
    },
  ],
};

@ApiTags('webhooks')
@Controller('v1/webhooks/public-keys')
export class WebhookPublicKeysController {
  constructor(private readonly signingKeys: WebhookSigningKeysService) {}

  @Get()
  @ApiOperation({
    summary: 'List platform Ed25519 webhook verification keys',
    description:
      'Public, unauthenticated. Returns the key that currently signs `ed25519` deliveries plus any rotated-out keys ' +
      'still inside their grace period. Match the `kid` in `X-FacilPay-Signature` to a key in this list.',
  })
  @ApiOkResponse({ description: 'Published public keys', schema: { example: PUBLIC_KEYS_EXAMPLE } })
  async list() {
    return { keys: await this.signingKeys.listPublicKeys() };
  }

  @Post('rotate')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('bearer')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({
    summary: 'Rotate the platform webhook signing key (admin)',
    description:
      'Creates a new active Ed25519 key. Previously active keys stay published as `retiring` for the grace period ' +
      '(default `WEBHOOK_SIGNING_KEY_GRACE_PERIOD_HOURS`, 72h).',
  })
  @ApiBody({ type: RotateSigningKeyDto, required: false })
  @ApiOkResponse({ description: 'Published public keys after rotation', schema: { example: PUBLIC_KEYS_EXAMPLE } })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid JWT.' })
  @ApiForbiddenResponse({ description: 'Caller is not a platform admin.' })
  async rotate(@Body() dto: RotateSigningKeyDto = {}) {
    return { keys: await this.signingKeys.rotate(dto?.gracePeriodHours) };
  }
}

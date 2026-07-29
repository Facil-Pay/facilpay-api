import { Controller, Patch, Get, Body, UseGuards } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiBody,
  ApiOkResponse,
  ApiUnauthorizedResponse,
  ApiBadRequestResponse,
  ApiForbiddenResponse,
} from '@nestjs/swagger';
import { MerchantsService } from './merchants.service';
import { UpdateGeoRestrictionsDto } from './dto/update-geo-restrictions.dto';
import { UpdateIpAllowlistDto } from './dto/update-ip-allowlist.dto';
import { MerchantGeoRestriction } from './entities/merchant-geo-restriction.entity';
import { MerchantIpAllowlist } from './entities/merchant-ip-allowlist.entity';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '../users/user.entity';

@ApiTags('merchants')
@ApiBearerAuth('bearer')
@UseGuards(JwtAuthGuard)
@Controller('v1/merchants')
export class MerchantsController {
  constructor(private readonly merchantsService: MerchantsService) {}

  @Patch('me/geo-restrictions')
  @ApiOperation({
    summary: 'Configure geographic payment restrictions',
    description:
      'Sets the allowed/blocked country list for the authenticated merchant. Payments from IPs geolocated to a ' +
      'non-allowed or blocked country are rejected with 403 (geo_restricted).',
  })
  @ApiBody({ type: UpdateGeoRestrictionsDto })
  @ApiOkResponse({
    description: 'Geo-restriction config updated.',
    schema: {
      example: {
        id: '123e4567-e89b-12d3-a456-426614174000',
        merchantId: 'abc123-merchant-uuid',
        allowedCountries: ['US', 'GB', 'NG'],
        blockedCountries: null,
        bypassInTestMode: true,
        createdAt: '2026-01-26T10:00:00.000Z',
        updatedAt: '2026-01-26T10:00:00.000Z',
      },
    },
  })
  @ApiBadRequestResponse({ description: 'Validation failed (invalid country code).' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid JWT.' })
  updateGeoRestrictions(
    @Body() dto: UpdateGeoRestrictionsDto,
    @CurrentUser() user: User,
  ): Promise<MerchantGeoRestriction> {
    return this.merchantsService.upsertGeoRestrictions(user.id, dto);
  }

  @Patch('me/ip-allowlist')
  @ApiOperation({
    summary: 'Configure IP allowlist for API access',
    description:
      'Sets the list of allowed IP addresses or CIDR ranges for the authenticated merchant. ' +
      'An empty array removes all IP restrictions (default: no restriction). ' +
      'Supports both IPv4 (e.g. "1.2.3.4", "10.0.0.0/8") and IPv6 addresses.',
  })
  @ApiBody({ type: UpdateIpAllowlistDto })
  @ApiOkResponse({
    description: 'IP allowlist updated.',
    schema: {
      example: {
        id: '123e4567-e89b-12d3-a456-426614174000',
        merchantId: 'abc123-merchant-uuid',
        allowedIps: ['1.2.3.4', '10.0.0.0/8'],
        createdAt: '2026-01-26T10:00:00.000Z',
        updatedAt: '2026-01-26T10:00:00.000Z',
      },
    },
  })
  @ApiBadRequestResponse({ description: 'Validation failed (invalid IP or CIDR).' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid JWT.' })
  updateIpAllowlist(
    @Body() dto: UpdateIpAllowlistDto,
    @CurrentUser() user: User,
  ): Promise<MerchantIpAllowlist> {
    return this.merchantsService.upsertIpAllowlist(user.id, dto);
  }

  @Get('me/ip-allowlist')
  @ApiOperation({
    summary: 'Get current IP allowlist',
    description: 'Returns the current IP allowlist config for the authenticated merchant.',
  })
  @ApiOkResponse({
    description: 'Current IP allowlist.',
    schema: {
      example: {
        id: '123e4567-e89b-12d3-a456-426614174000',
        merchantId: 'abc123-merchant-uuid',
        allowedIps: ['1.2.3.4', '10.0.0.0/8'],
        createdAt: '2026-01-26T10:00:00.000Z',
        updatedAt: '2026-01-26T10:00:00.000Z',
      },
    },
  })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid JWT.' })
  async getIpAllowlist(
    @CurrentUser() user: User,
  ): Promise<{ merchantId: string; allowedIps: string[] }> {
    const record = await this.merchantsService.getIpAllowlist(user.id);
    return { merchantId: user.id, allowedIps: record?.allowedIps ?? [] };
  }
}

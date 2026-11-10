import { Controller, Patch, Get, Put, Body, UseGuards, UseInterceptors, UploadedFile, Post, Param } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiBody,
  ApiOkResponse,
  ApiUnauthorizedResponse,
  ApiBadRequestResponse,
  ApiForbiddenResponse,
  ApiConsumes,
} from '@nestjs/swagger';
import { UpdateSettingsDto } from './dto/update-settings.dto';
import { MerchantsService } from './merchants.service';
import { UpdateGeoRestrictionsDto } from './dto/update-geo-restrictions.dto';
import { UpdateIpAllowlistDto } from './dto/update-ip-allowlist.dto';
import { MerchantProfileResponseDto, UpdateMerchantProfileDto } from './dto/merchant-profile.dto';
import { MerchantGeoRestriction } from './entities/merchant-geo-restriction.entity';
import { MerchantIpAllowlist } from './entities/merchant-ip-allowlist.entity';
import { MerchantBranding } from './entities/merchant-branding.entity';
import { MerchantSettings } from './entities/merchant-settings.entity';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '../users/user.entity';
import { MerchantLimitsService } from './merchant-limits.service';
import { UpsertMerchantLimitsDto } from './dto/upsert-merchant-limits.dto';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../../common/constants/roles';

@ApiTags('merchants')
@ApiBearerAuth('bearer')
@UseGuards(JwtAuthGuard)
@Controller('v1/merchants')
export class MerchantsController {
  constructor(
    private readonly merchantsService: MerchantsService,
    private readonly merchantLimitsService: MerchantLimitsService,
  ) {}

  @Get('me/limits')
  @ApiOperation({ summary: 'Get the authenticated merchant volume limits' })
  getMyLimits(@CurrentUser() user: User) {
    return this.merchantLimitsService.getForMerchant(user.id);
  }

  @Patch('admin/:merchantId/limits')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Configure volume limits for a merchant (admin)' })
  upsertMerchantLimits(
    @Param('merchantId') merchantId: string,
    @Body() dto: UpsertMerchantLimitsDto,
  ) {
    return this.merchantLimitsService.upsert(merchantId, dto);
  }

  @Get('me')
  @ApiOperation({
    summary: 'Get merchant profile',
    description: 'Returns the authenticated merchant\'s business profile information.',
  })
  @ApiOkResponse({
    description: 'Merchant profile.',
    type: MerchantProfileResponseDto,
  })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid JWT.' })
  getProfile(@CurrentUser() user: User): Promise<MerchantProfileResponseDto> {
    return this.merchantsService.getProfile(user.id);
  }

  @Patch('me')
  @ApiOperation({
    summary: 'Update merchant profile',
    description: 'Updates the merchant\'s business profile. Changes to legalName or country trigger re-review.',
  })
  @ApiBody({ type: UpdateMerchantProfileDto })
  @ApiOkResponse({
    description: 'Profile updated.',
    type: MerchantProfileResponseDto,
  })
  @ApiBadRequestResponse({ description: 'Validation failed.' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid JWT.' })
  updateProfile(
    @Body() dto: UpdateMerchantProfileDto,
    @CurrentUser() user: User,
  ): Promise<MerchantProfileResponseDto> {
    return this.merchantsService.updateProfile(user.id, dto, user.id);
  }

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

  // ============ Branding Endpoints ============

  @Get('me/branding')
  @ApiOperation({
    summary: 'Get merchant branding',
    description: 'Returns the current branding configuration for the authenticated merchant. Returns defaults if not set.',
  })
  @ApiOkResponse({
    description: 'Current branding configuration.',
    schema: {
      example: {
        merchantId: 'abc123-merchant-uuid',
        displayName: 'My Store',
        logo: 'https://storage.googleapis.com/facilpay-assets/branding/logos/abc.png',
        primaryColor: '#1a1a2e',
        supportEmail: 'support@mystore.com',
        supportUrl: 'https://mystore.com/support',
        createdAt: '2026-01-26T10:00:00.000Z',
        updatedAt: '2026-01-26T10:00:00.000Z',
      },
    },
  })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid JWT.' })
  async getBranding(
    @CurrentUser() user: User,
  ): Promise<MerchantBranding | object> {
    const branding = await this.merchantsService.getBranding(user.id);
    if (!branding) {
      return {
        merchantId: user.id,
        displayName: 'FacilPay',
        logo: null,
        primaryColor: '#1a1a2e',
        supportEmail: 'support@facilpay.com',
        supportUrl: 'https://facilpay.com',
      };
    }
    return branding;
  }

  @Patch('me/branding')
  @ApiOperation({
    summary: 'Update merchant branding',
    description: 'Updates the branding configuration for the authenticated merchant.',
  })
  @ApiBody({ type: UpdateBrandingDto })
  @ApiOkResponse({
    description: 'Branding configuration updated.',
    schema: {
      example: {
        id: '123e4567-e89b-12d3-a456-426614174000',
        merchantId: 'abc123-merchant-uuid',
        displayName: 'My Store',
        logo: null,
        primaryColor: '#ff5500',
        supportEmail: 'support@mystore.com',
        supportUrl: 'https://mystore.com/support',
        createdAt: '2026-01-26T10:00:00.000Z',
        updatedAt: '2026-01-26T12:00:00.000Z',
      },
    },
  })
  @ApiBadRequestResponse({ description: 'Validation failed.' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid JWT.' })
  updateBranding(
    @Body() dto: UpdateBrandingDto,
    @CurrentUser() user: User,
  ): Promise<MerchantBranding> {
    return this.merchantsService.upsertBranding(user.id, dto);
  }

  @Put('me/branding/logo')
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({
    summary: 'Upload merchant logo',
    description: 'Uploads a logo for the merchant. Accepts PNG or SVG files up to 500KB.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiOkResponse({
    description: 'Logo uploaded successfully.',
    schema: {
      example: {
        logoUrl: 'https://storage.googleapis.com/facilpay-assets/branding/logos/abc123.png',
      },
    },
  })
  @ApiBadRequestResponse({ description: 'Invalid file type or size.' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid JWT.' })
  uploadLogo(
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: User,
  ): Promise<{ logoUrl: string }> {
    return this.merchantsService.uploadLogo(user.id, file);
  }

  // ============ Settings Endpoints ============

  @Get('me/settings')
  @ApiOperation({
    summary: 'Get merchant settings',
    description: 'Returns the current settings for the authenticated merchant.',
  })
  @ApiOkResponse({
    description: 'Current merchant settings.',
    schema: {
      example: {
        merchantId: 'abc123-merchant-uuid',
        idleSessionTimeoutMinutes: null,
        remindersEnabled: true,
        reminderOffsets: [-3, 0, 7],
        createdAt: '2026-01-26T10:00:00.000Z',
        updatedAt: '2026-01-26T10:00:00.000Z',
      },
    },
  })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid JWT.' })
  async getSettings(
    @CurrentUser() user: User,
  ): Promise<MerchantSettings | object> {
    const settings = await this.merchantsService.getSettings(user.id);
    if (!settings) {
      return {
        merchantId: user.id,
        remindersEnabled: true,
        reminderOffsets: [-3, 0, 7],
      };
    }
    return settings;
  }

  @Patch('me/settings')
  @ApiOperation({
    summary: 'Update merchant settings',
    description: 'Updates the settings for the authenticated merchant.',
  })
  @ApiBody({ type: UpdateSettingsDto })
  @ApiOkResponse({
    description: 'Settings updated.',
    schema: {
      example: {
        id: '123e4567-e89b-12d3-a456-426614174000',
        merchantId: 'abc123-merchant-uuid',
        remindersEnabled: false,
        reminderOffsets: [0, 7],
        createdAt: '2026-01-26T10:00:00.000Z',
        updatedAt: '2026-01-26T12:00:00.000Z',
      },
    },
  })
  @ApiBadRequestResponse({ description: 'Validation failed.' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid JWT.' })
  updateSettings(
    @Body() dto: UpdateSettingsDto,
    @CurrentUser() user: User,
  ): Promise<MerchantSettings> {
    return this.merchantsService.upsertSettings(user.id, dto);
  }

  @Post('me/close')
  @ApiOperation({
    summary: 'Close merchant account',
    description:
      'Closes the authenticated merchant account after verifying that no open disputes, pending payouts, or unsettled balance remain. Deactivates API keys, webhooks, and payment links while retaining financial records.',
  })
  @ApiOkResponse({
    description: 'Merchant account closed.',
  })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid JWT.' })
  closeAccount(@CurrentUser() user: User) {
    return this.merchantsService.closeAccount(user.id, user.id);
  }
}

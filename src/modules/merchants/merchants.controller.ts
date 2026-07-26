import { Controller, Patch, Body, UseGuards } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiBody,
  ApiOkResponse,
  ApiUnauthorizedResponse,
  ApiBadRequestResponse,
} from '@nestjs/swagger';
import { MerchantsService } from './merchants.service';
import { UpdateGeoRestrictionsDto } from './dto/update-geo-restrictions.dto';
import { MerchantGeoRestriction } from './entities/merchant-geo-restriction.entity';
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
}

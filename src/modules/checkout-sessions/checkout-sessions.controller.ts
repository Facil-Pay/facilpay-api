import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiOkResponse,
  ApiNotFoundResponse,
  ApiGoneResponse,
  ApiUnauthorizedResponse,
  ApiBadRequestResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { CheckoutSessionsService } from './checkout-sessions.service';
import {
  ApplyCheckoutCouponDto,
  CreateCheckoutSessionDto,
  SubmitShippingAddressDto,
} from './dto/create-checkout-session.dto';
import {
  CheckoutSession,
  CheckoutSessionStatus,
} from './entities/checkout-session.entity';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '../users/user.entity';

@ApiTags('checkout-sessions')
@Controller('v1/checkout/sessions')
export class CheckoutSessionsController {
  constructor(private readonly service: CheckoutSessionsService) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('bearer')
  @ApiOperation({
    summary: 'Create a new checkout session',
    description:
      'Creates a one-time checkout session with line items. Returns a publicId for the payer URL.',
  })
  @ApiOkResponse({
    description: 'Checkout session created',
    schema: {
      example: {
        id: '123e4567-e89b-12d3-a456-426614174000',
        publicId: 'abc123def456',
        merchantId: 'abc123-merchant-uuid',
        lineItems: [{ name: 'Product 1', quantity: 2, unitAmount: 1000 }],
        currency: 'USD',
        total: 2500,
        shippingAddressCollection: { allowedCountries: ['US', 'CA'] },
        shippingOptions: [
          { id: 'standard', label: 'Standard shipping', amount: 500 },
        ],
        shippingAmount: 500,
        successUrl: 'https://example.com/success',
        cancelUrl: 'https://example.com/cancel',
        expiresAt: '2026-01-26T12:00:00.000Z',
        status: 'OPEN',
        createdAt: '2026-01-26T10:30:00.000Z',
      },
    },
  })
  @ApiBadRequestResponse({
    description: 'Validation failed or invalid line items',
  })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid JWT' })
  async create(
    @Body() dto: CreateCheckoutSessionDto,
    @CurrentUser() user: User,
  ): Promise<CheckoutSession> {
    return this.service.create(user.id, dto);
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('bearer')
  @ApiOperation({
    summary: 'Get checkout session by ID',
    description:
      'Returns a checkout session by its internal ID. Only returns sessions owned by the authenticated merchant.',
  })
  @ApiOkResponse({ description: 'Checkout session details' })
  @ApiNotFoundResponse({ description: 'Session not found' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid JWT' })
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: User,
  ): Promise<CheckoutSession> {
    return this.service.findById(id, user.id);
  }

  @Post(':id/expire')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('bearer')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Expire a checkout session',
    description: 'Manually expires an OPEN checkout session.',
  })
  @ApiOkResponse({ description: 'Session expired successfully' })
  @ApiBadRequestResponse({
    description: 'Session is not open or already expired',
  })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid JWT' })
  async expire(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: User,
  ): Promise<CheckoutSession> {
    return this.service.expire(id, user.id);
  }

  @Get()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('bearer')
  @ApiOperation({
    summary: 'List checkout sessions',
    description:
      'Returns all checkout sessions for the authenticated merchant.',
  })
  @ApiOkResponse({ description: 'List of checkout sessions' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid JWT' })
  async findAll(
    @Query('limit') limit?: number,
    @Query('offset') offset?: number,
    @CurrentUser() user?: User,
  ): Promise<{ sessions: CheckoutSession[]; total: number }> {
    return this.service.findAll(user.id, {
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });
  }
}

// Public controller for payer-facing endpoints
@ApiTags('checkout-sessions (public)')
@Controller('v1/checkout/sessions')
export class CheckoutSessionsPublicController {
  constructor(private readonly service: CheckoutSessionsService) {}

  @Get(':publicId/public')
  @ApiOperation({
    summary: 'Get public checkout session',
    description:
      'Returns public checkout session info for payers. No authentication required.',
  })
  @ApiOkResponse({
    description: 'Public checkout session details',
    schema: {
      example: {
        merchantDisplayName: 'My Store',
        merchantLogo: 'https://storage.example.com/logo.png',
        primaryColor: '#1a1a2e',
        lineItems: [{ name: 'Product 1', quantity: 2, unitAmount: 1000 }],
        subtotalFormatted: 'USD 20.00',
        discountFormatted: 'USD 2.00',
        shippingFormatted: 'USD 5.00',
        couponCode: 'SPRING10',
        totalFormatted: 'USD 23.00',
        shippingAddressCollection: { allowedCountries: ['US', 'CA'] },
        shippingOptions: [
          { id: 'standard', label: 'Standard shipping', amount: 500 },
        ],
        shippingAddress: null,
        shippingOptionId: null,
        status: 'OPEN',
        isExpired: false,
        successUrl: 'https://example.com/success',
        cancelUrl: 'https://example.com/cancel',
      },
    },
  })
  @ApiNotFoundResponse({ description: 'Session not found' })
  @ApiGoneResponse({ description: 'Session has expired' })
  async getPublic(@Param('publicId') publicId: string): Promise<object> {
    const { session, branding } = await this.service.getPublicSession(publicId);

    const isExpired =
      session.status === CheckoutSessionStatus.EXPIRED ||
      (session.status === CheckoutSessionStatus.OPEN &&
        new Date() > session.expiresAt);

    return {
      merchantDisplayName: branding.displayName,
      merchantLogo: branding.logo,
      primaryColor: branding.primaryColor,
      lineItems: session.lineItems,
      ...this.formatAmounts(session),
      shippingAddressCollection: session.shippingAddressCollection ?? null,
      shippingOptions: session.shippingOptions ?? [],
      shippingAddress: session.shippingAddress ?? null,
      shippingOptionId: session.shippingOptionId ?? null,
      status: session.status,
      isExpired,
      successUrl: session.successUrl,
      cancelUrl: session.cancelUrl,
    };
  }

  @Post(':publicId/shipping-address')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Submit a shipping address for a checkout session',
    description:
      'Stores the payer shipping address on the session, validates the ISO country code against the merchant allowlist, applies the selected fixed shipping rate to the total and copies the address to the customer on completion. No authentication required.',
  })
  @ApiOkResponse({
    description:
      'Shipping address stored; returns recomputed amounts with shipping shown separately.',
  })
  @ApiBadRequestResponse({
    description:
      'Session does not collect shipping, invalid address, country not allowed or unknown shipping option',
  })
  @ApiNotFoundResponse({ description: 'Session not found' })
  @ApiGoneResponse({ description: 'Session has expired' })
  async submitShippingAddress(
    @Param('publicId') publicId: string,
    @Body() dto: SubmitShippingAddressDto,
  ): Promise<object> {
    const session = await this.service.submitShippingAddress(publicId, dto);
    return {
      ...this.formatAmounts(session),
      shippingAddress: session.shippingAddress,
      shippingOptionId: session.shippingOptionId,
    };
  }

  @Post(':publicId/coupon')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Apply a coupon to a checkout session',
    description:
      'Validates the coupon against the session currency and amount and recomputes the total. The redemption is only counted when the session completes. No authentication required.',
  })
  @ApiOkResponse({ description: 'Coupon applied; returns recomputed amounts.' })
  @ApiBadRequestResponse({ description: 'Session is not open' })
  @ApiNotFoundResponse({ description: 'Session not found' })
  @ApiGoneResponse({ description: 'Session has expired' })
  @ApiUnprocessableEntityResponse({
    description: 'Coupon is invalid, expired, exhausted or does not apply',
  })
  async applyCoupon(
    @Param('publicId') publicId: string,
    @Body() dto: ApplyCheckoutCouponDto,
  ): Promise<object> {
    const session = await this.service.applyCoupon(publicId, dto.couponCode);
    return this.formatAmounts(session);
  }

  @Delete(':publicId/coupon')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Remove the coupon from a checkout session',
    description: 'Restores the undiscounted total. No authentication required.',
  })
  @ApiOkResponse({ description: 'Coupon removed; returns recomputed amounts.' })
  @ApiBadRequestResponse({ description: 'Session is not open' })
  @ApiNotFoundResponse({ description: 'Session not found' })
  @ApiGoneResponse({ description: 'Session has expired' })
  async removeCoupon(@Param('publicId') publicId: string): Promise<object> {
    const session = await this.service.removeCoupon(publicId);
    return this.formatAmounts(session);
  }

  private formatAmounts(session: CheckoutSession) {
    const format = (minor: number) =>
      `${session.currency} ${(Number(minor) / 100).toFixed(2)}`;
    return {
      subtotalFormatted: format(session.subtotal ?? session.total),
      discountFormatted: format(session.discountAmount ?? 0),
      shippingFormatted: format(session.shippingAmount ?? 0),
      couponCode: session.couponCode ?? null,
      totalFormatted: format(session.total),
    };
  }
}

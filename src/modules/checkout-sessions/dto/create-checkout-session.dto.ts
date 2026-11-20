import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsArray,
  ValidateNested,
  IsInt,
  IsPositive,
  Min,
  MaxLength,
  IsUrl,
  IsEmail,
  Max,
  ArrayMaxSize,
  IsISO31661Alpha2,
} from 'class-validator';
import { Type } from 'class-transformer';
import { IsISO4217CurrencyCode } from '../../../common/validators/is-iso4217-currency-code.validator';

export class LineItemDto {
  @ApiPropertyOptional({
    description: 'Product ID from catalog',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @IsOptional()
  @IsString()
  productId?: string;

  @ApiPropertyOptional({
    description: 'Item name. Optional if productId is provided.',
    example: 'Product 1',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @ApiPropertyOptional({
    description: 'Item description',
    example: 'A great product',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiProperty({ description: 'Quantity', example: 2 })
  @IsInt()
  @IsPositive()
  quantity: number;

  @ApiPropertyOptional({
    description:
      'Unit amount in smallest currency unit. Optional if productId is provided.',
    example: 1000,
  })
  @IsOptional()
  @IsInt()
  @IsPositive()
  @Min(1)
  unitAmount?: number;
}

export class ShippingAddressCollectionDto {
  @ApiProperty({
    description:
      'ISO 3166-1 alpha-2 country codes allowed for shipping. An empty list allows any valid country.',
    example: ['US', 'CA'],
    type: [String],
    maxItems: 249,
  })
  @IsArray()
  @ArrayMaxSize(249)
  @IsISO31661Alpha2({ each: true })
  allowedCountries: string[];
}

export class ShippingOptionDto {
  @ApiProperty({
    description: 'Stable identifier of the shipping option',
    example: 'standard',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  id: string;

  @ApiProperty({
    description: 'Label shown to the payer',
    example: 'Standard shipping',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  label: string;

  @ApiProperty({
    description: 'Fixed rate in the smallest currency unit (e.g., cents)',
    example: 500,
  })
  @IsInt()
  @Min(0)
  amount: number;
}

export class ShippingAddressDto {
  @ApiPropertyOptional({
    description: 'Recipient name',
    example: 'Jane Doe',
    maxLength: 255,
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;

  @ApiProperty({
    description: 'Street address',
    example: '123 Main St',
    maxLength: 255,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  line1: string;

  @ApiPropertyOptional({
    description: 'Apartment, suite, etc.',
    example: 'Apt 4B',
    maxLength: 255,
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  line2?: string;

  @ApiProperty({ description: 'City', example: 'New York', maxLength: 100 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  city: string;

  @ApiPropertyOptional({
    description: 'State or region',
    example: 'NY',
    maxLength: 100,
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  state?: string;

  @ApiProperty({ description: 'Postal code', example: '10001', maxLength: 20 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  postalCode: string;

  @ApiProperty({
    description: 'Country as an ISO 3166-1 alpha-2 code',
    example: 'US',
  })
  @IsISO31661Alpha2()
  country: string;
}

export class SubmitShippingAddressDto {
  @ApiProperty({
    description: 'Shipping address supplied by the payer',
    type: ShippingAddressDto,
  })
  @ValidateNested()
  @Type(() => ShippingAddressDto)
  shippingAddress: ShippingAddressDto;

  @ApiPropertyOptional({
    description:
      'Identifier of the shipping option to use. Required when the session offers shipping options and none was preselected.',
    example: 'standard',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  shippingOptionId?: string;
}

export class CreateCheckoutSessionDto {
  @ApiProperty({
    description: 'Line items for the checkout session',
    type: [LineItemDto],
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LineItemDto)
  lineItems: LineItemDto[];

  @ApiProperty({ description: 'Currency code (ISO 4217)', example: 'USD' })
  @IsString()
  @IsISO4217CurrencyCode({ supportedOnly: true })
  currency: string;

  @ApiPropertyOptional({
    description: 'Customer ID from merchant system',
    example: 'cus_123',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  customerId?: string;

  @ApiPropertyOptional({
    description: 'Customer email',
    example: 'customer@example.com',
  })
  @IsOptional()
  @IsEmail()
  customerEmail?: string;

  @ApiProperty({
    description: 'Success redirect URL',
    example: 'https://example.com/success',
  })
  @IsString()
  @IsUrl()
  successUrl: string;

  @ApiProperty({
    description: 'Cancel redirect URL',
    example: 'https://example.com/cancel',
  })
  @IsString()
  @IsUrl()
  cancelUrl: string;

  @ApiPropertyOptional({
    description:
      'Coupon code to apply. Validated against the session currency and amount.',
    example: 'SPRING10',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  couponCode?: string;

  @ApiPropertyOptional({
    description: 'Enables shipping address collection for this session',
    type: ShippingAddressCollectionDto,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => ShippingAddressCollectionDto)
  shippingAddressCollection?: ShippingAddressCollectionDto;

  @ApiPropertyOptional({
    description: 'Optional fixed shipping rates available for this session',
    type: [ShippingOptionDto],
    maxItems: 20,
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => ShippingOptionDto)
  shippingOptions?: ShippingOptionDto[];

  @ApiPropertyOptional({
    description:
      'Preselect a shipping option by id. Its amount is included in the session total immediately.',
    example: 'standard',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  shippingOptionId?: string;

  @ApiPropertyOptional({
    description: 'Session expiry in minutes',
    example: 30,
    default: 30,
  })
  @IsOptional()
  @IsInt()
  @Min(5)
  @Max(1440) // Max 24 hours
  expiresInMinutes?: number;
}

export class ApplyCheckoutCouponDto {
  @ApiProperty({
    description: 'Coupon code to apply to the session',
    example: 'SPRING10',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  couponCode: string;
}

export class UpdateCheckoutSessionDto extends PartialType(
  CreateCheckoutSessionDto,
) {}

export class CheckoutSessionResponseDto {
  @ApiProperty({ description: 'Session public ID for URLs' })
  publicId: string;

  @ApiProperty({ description: 'Full checkout URL for payer' })
  checkoutUrl: string;

  @ApiProperty({ description: 'Session status' })
  status: string;

  @ApiProperty({ description: 'Session expiry time' })
  expiresAt: Date;

  @ApiProperty({ description: 'Total amount in smallest currency unit' })
  total: number;

  @ApiProperty({ description: 'Currency code' })
  currency: string;

  @ApiProperty({ description: 'Shipping amount in smallest currency unit' })
  shippingAmount: number;
}

export class PublicCheckoutSessionDto {
  @ApiProperty({ description: 'Merchant display name' })
  merchantDisplayName: string;

  @ApiProperty({ description: 'Merchant logo URL' })
  merchantLogo: string | null;

  @ApiProperty({ description: 'Primary brand color' })
  primaryColor: string;

  @ApiProperty({ description: 'Line items' })
  lineItems: LineItemDto[];

  @ApiProperty({ description: 'Subtotal before discount, formatted' })
  subtotalFormatted: string;

  @ApiProperty({ description: 'Coupon discount, formatted' })
  discountFormatted: string;

  @ApiProperty({
    description: 'Shipping amount, formatted separately from the subtotal',
  })
  shippingFormatted: string;

  @ApiProperty({ description: 'Applied coupon code', nullable: true })
  couponCode: string | null;

  @ApiProperty({ description: 'Total amount formatted' })
  totalFormatted: string;

  @ApiProperty({
    description: 'Shipping address collection settings, when enabled',
    type: ShippingAddressCollectionDto,
    nullable: true,
  })
  shippingAddressCollection: ShippingAddressCollectionDto | null;

  @ApiProperty({
    description: 'Fixed shipping rates',
    type: [ShippingOptionDto],
  })
  shippingOptions: ShippingOptionDto[];

  @ApiProperty({
    description: 'Shipping address collected from the payer',
    type: ShippingAddressDto,
    nullable: true,
  })
  shippingAddress: ShippingAddressDto | null;

  @ApiProperty({ description: 'Selected shipping option id', nullable: true })
  shippingOptionId: string | null;

  @ApiProperty({ description: 'Session status' })
  status: string;

  @ApiProperty({ description: 'Whether session is expired' })
  isExpired: boolean;

  @ApiProperty({ description: 'Success URL' })
  successUrl: string;

  @ApiProperty({ description: 'Cancel URL' })
  cancelUrl: string;
}

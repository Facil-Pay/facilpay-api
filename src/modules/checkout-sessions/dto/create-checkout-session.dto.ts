import {
  ApiProperty,
  ApiPropertyOptional,
  PartialType,
} from '@nestjs/swagger';
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

  @ApiPropertyOptional({ description: 'Item name. Optional if productId is provided.', example: 'Product 1' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @ApiPropertyOptional({ description: 'Item description', example: 'A great product' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiProperty({ description: 'Quantity', example: 2 })
  @IsInt()
  @IsPositive()
  quantity: number;

  @ApiPropertyOptional({
    description: 'Unit amount in smallest currency unit. Optional if productId is provided.',
    example: 1000,
  })
  @IsOptional()
  @IsInt()
  @IsPositive()
  @Min(1)
  unitAmount?: number;
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

  @ApiPropertyOptional({ description: 'Customer ID from merchant system', example: 'cus_123' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  customerId?: string;

  @ApiPropertyOptional({ description: 'Customer email', example: 'customer@example.com' })
  @IsOptional()
  @IsEmail()
  customerEmail?: string;

  @ApiProperty({ description: 'Success redirect URL', example: 'https://example.com/success' })
  @IsString()
  @IsUrl()
  successUrl: string;

  @ApiProperty({ description: 'Cancel redirect URL', example: 'https://example.com/cancel' })
  @IsString()
  @IsUrl()
  cancelUrl: string;

  @ApiPropertyOptional({
    description: 'Coupon code to apply. Validated against the session currency and amount.',
    example: 'SPRING10',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  couponCode?: string;

  @ApiPropertyOptional({ description: 'Session expiry in minutes', example: 30, default: 30 })
  @IsOptional()
  @IsInt()
  @Min(5)
  @Max(1440) // Max 24 hours
  expiresInMinutes?: number;
}

export class ApplyCheckoutCouponDto {
  @ApiProperty({ description: 'Coupon code to apply to the session', example: 'SPRING10' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  couponCode: string;
}

export class UpdateCheckoutSessionDto extends PartialType(CreateCheckoutSessionDto) {}

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

  @ApiProperty({ description: 'Applied coupon code', nullable: true })
  couponCode: string | null;

  @ApiProperty({ description: 'Total amount formatted' })
  totalFormatted: string;

  @ApiProperty({ description: 'Session status' })
  status: string;

  @ApiProperty({ description: 'Whether session is expired' })
  isExpired: boolean;

  @ApiProperty({ description: 'Success URL' })
  successUrl: string;

  @ApiProperty({ description: 'Cancel URL' })
  cancelUrl: string;
}

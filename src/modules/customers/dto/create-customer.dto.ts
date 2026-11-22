import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsEmail,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class CreateCustomerDto {
  @IsEmail()
  @IsNotEmpty()
  @MaxLength(320)
  @ApiProperty({
    description:
      'Customer email address. Email uniqueness is case-insensitive within a merchant.',
    example: 'jane.doe@example.com',
    maxLength: 320,
  })
  email: string;

  @IsString()
  @MaxLength(255)
  @IsOptional()
  @ApiPropertyOptional({
    description: 'Customer display name',
    example: 'Jane Doe',
    maxLength: 255,
    nullable: true,
  })
  name?: string | null;

  @IsString()
  @MaxLength(50)
  @IsOptional()
  @ApiPropertyOptional({
    description: 'Customer phone number',
    example: '+1-555-0100',
    maxLength: 50,
    nullable: true,
  })
  phone?: string | null;

  @IsObject()
  @IsOptional()
  @ApiPropertyOptional({
    description: 'Arbitrary JSON object supplied by the merchant',
    example: { tier: 'gold', locale: 'en-US' },
    type: 'object',
    additionalProperties: true,
  })
  metadata?: Record<string, unknown> | null;

  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(50, { each: true })
  @IsOptional()
  @ApiPropertyOptional({
    description:
      'Tags used to segment customers. Stored trimmed and lowercased, duplicates removed.',
    example: ['vip', 'wholesale'],
    type: [String],
    maxItems: 20,
  })
  tags?: string[];
}

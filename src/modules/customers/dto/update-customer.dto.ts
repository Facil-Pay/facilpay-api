import { ApiPropertyOptional } from '@nestjs/swagger';
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

export class UpdateCustomerDto {
  @IsEmail()
  @IsNotEmpty()
  @MaxLength(320)
  @IsOptional()
  @ApiPropertyOptional({
    description:
      'Customer email address. Email uniqueness is case-insensitive within a merchant.',
    example: 'jane.doe@example.com',
    maxLength: 320,
  })
  email?: string;

  @IsString()
  @MaxLength(255)
  @IsOptional()
  @ApiPropertyOptional({
    description: 'Customer display name. Send null to clear it.',
    example: 'Jane Doe',
    maxLength: 255,
    nullable: true,
  })
  name?: string | null;

  @IsString()
  @MaxLength(50)
  @IsOptional()
  @ApiPropertyOptional({
    description: 'Customer phone number. Send null to clear it.',
    example: '+1-555-0100',
    maxLength: 50,
    nullable: true,
  })
  phone?: string | null;

  @IsObject()
  @IsOptional()
  @ApiPropertyOptional({
    description: 'Arbitrary JSON object. Send null to clear it.',
    example: { tier: 'gold', locale: 'en-US' },
    type: 'object',
    additionalProperties: true,
    nullable: true,
  })
  metadata?: Record<string, unknown> | null;

  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(50, { each: true })
  @IsOptional()
  @ApiPropertyOptional({
    description:
      'Replacement set of tags, stored trimmed and lowercased with duplicates removed. Send [] to clear them.',
    example: ['vip', 'wholesale'],
    type: [String],
    maxItems: 20,
  })
  tags?: string[];
}

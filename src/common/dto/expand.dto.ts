import { BadRequestException } from '@nestjs/common';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class ExpandDto {
  @ApiPropertyOptional({
    description:
      'Comma-separated list of related objects to embed in the response (e.g. customer,refunds,paymentLink)',
    example: 'customer,refunds,paymentLink',
  })
  @IsOptional()
  @IsString()
  expand?: string;
}

export const PAYMENT_EXPAND_WHITELIST = [
  'customer',
  'refunds',
  'paymentLink',
] as const;

export type PaymentExpandField = (typeof PAYMENT_EXPAND_WHITELIST)[number];

export const RESOURCE_EXPAND_WHITELISTS: Record<string, readonly string[]> = {
  payment: PAYMENT_EXPAND_WHITELIST,
};

/**
 * Parses and validates a comma-separated `expand` query parameter against a
 * resource-specific whitelist. Throws `BadRequestException` (400) if any
 * unknown expand key is requested.
 */
export function parseExpandQuery<T extends string>(
  expand: string | string[] | undefined | null,
  allowedKeys: readonly T[],
): Set<T> {
  if (!expand) {
    return new Set<T>();
  }

  const rawItems = (Array.isArray(expand) ? expand : [expand])
    .flatMap((entry) => String(entry).split(','))
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

  const allowedSet = new Set<string>(allowedKeys);
  const unknown = rawItems.filter((item) => !allowedSet.has(item));

  if (unknown.length > 0) {
    throw new BadRequestException(
      `Unsupported expand field(s): ${unknown.join(', ')}. Allowed values: ${allowedKeys.join(', ')}`,
    );
  }

  return new Set<T>(rawItems as T[]);
}

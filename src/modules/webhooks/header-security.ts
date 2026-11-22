import { BadRequestException } from '@nestjs/common';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';
import { ValueTransformer } from 'typeorm';

export function validateHeaders(headers: unknown): asserts headers is Record<string, string> {
  if (!headers || typeof headers !== 'object' || Array.isArray(headers)) {
    throw new BadRequestException('headers must be an object of string values');
  }
  const seen = new Set<string>();
  const reserved = new Set(['host', 'content-length', 'content-type', 'connection', 'transfer-encoding', 'trailer', 'te', 'upgrade', 'expect', 'proxy-authorization', 'proxy-connection']);
  if (Object.keys(headers).length > 32) throw new BadRequestException('At most 32 custom headers are allowed');
  for (const [name, value] of Object.entries(headers)) {
    const lower = name.toLowerCase();
    if (name.length > 128 || !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name) || reserved.has(lower) || lower.startsWith('x-facilpay-') || lower.includes('signature') || seen.has(lower)) {
      throw new BadRequestException('Invalid, duplicate, or reserved webhook header');
    }
    if (typeof value !== 'string' || /[^\t\x20-\x7e\x80-\xff]/.test(value) || value.length > 4096) {
      throw new BadRequestException('Invalid webhook header value');
    }
    seen.add(lower);
  }
}

function key(): Buffer {
  const secret = process.env.WEBHOOK_HEADERS_ENCRYPTION_KEY;
  if (!secret) throw new Error('WEBHOOK_HEADERS_ENCRYPTION_KEY is required to store custom webhook headers');
  return createHash('sha256').update(secret).digest();
}

// JSONB stores an authenticated ciphertext envelope, never plaintext values.
export const encryptedHeadersTransformer: ValueTransformer = {
  to(value: Record<string, string> | null) {
    if (value == null) return null;
    validateHeaders(value);
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key(), iv);
    const data = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
    return { v: 1, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') };
  },
  from(value: any) {
    if (value == null) return null;
    if (value.v !== 1) throw new Error('Invalid encrypted webhook headers');
    const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(value.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(value.tag, 'base64'));
    const headers = JSON.parse(Buffer.concat([decipher.update(Buffer.from(value.data, 'base64')), decipher.final()]).toString('utf8'));
    validateHeaders(headers);
    return headers;
  },
};

export function maskEndpoint<
  T extends {
    headers?: Record<string, string> | null;
    previousSecret?: string | null;
  },
>(endpoint: T): T {
  return {
    ...endpoint,
    ...(endpoint.headers
      ? {
          headers: Object.fromEntries(
            Object.keys(endpoint.headers).map((name) => [name, '********']),
          ),
        }
      : {}),
    ...(endpoint.previousSecret ? { previousSecret: '********' } : {}),
  };
}

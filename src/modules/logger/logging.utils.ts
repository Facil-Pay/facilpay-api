import { Request } from 'express';

const HEADER_REDACT_KEYS = new Set(['authorization', 'cookie', 'set-cookie']);
const BODY_REDACT_KEYS = new Set([
  'password',
  'pass',
  'pwd',
  'token',
  'access_token',
  'refresh_token',
  'secret',
  'apikey',
  'api_key',
  'pin',
  'otp',
  'cardnumber',
  'card_number',
  'cvv',
  'cvc',
  'bankaccount',
  'bank_account',
  'accountnumber',
  'account_number',
]);

const REDACTED = '[REDACTED]';

export function sanitizeHeaders(
  headers: Request['headers'] | undefined,
): Record<string, unknown> | undefined {
  if (!headers) {
    return undefined;
  }

  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (HEADER_REDACT_KEYS.has(key.toLowerCase())) {
      sanitized[key] = REDACTED;
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
}

export function sanitizeBody(payload: unknown, maxLength: number): unknown {
  if (payload === undefined || payload === null) {
    return undefined;
  }

  const normalized = normalizePayload(payload);
  const redacted = redactSensitive(normalized);
  return truncatePayload(redacted, maxLength);
}

export function getRequestId(headers: Request['headers']): string | undefined {
  const requestId = headers['x-request-id'] ?? headers['x-correlation-id'];

  if (Array.isArray(requestId)) {
    return requestId[0];
  }

  if (typeof requestId === 'string' && requestId.trim()) {
    return requestId;
  }

  return undefined;
}

export function extractUserId(user: unknown): string | undefined {
  if (!user || typeof user !== 'object') {
    return undefined;
  }

  const record = user as Record<string, unknown>;
  const candidate = record.id ?? record.userId ?? record.sub;

  if (candidate === undefined || candidate === null) {
    return undefined;
  }

  if (typeof candidate === 'string') {
    return candidate;
  }

  if (typeof candidate === 'number') {
    return candidate.toString();
  }

  return undefined;
}

export function normalizeErrorContext(error: unknown): Record<string, unknown> | undefined {
  if (!error) {
    return undefined;
  }

  if (typeof error === 'string') {
    return { message: error };
  }

  if (error instanceof Error) {
    return { name: error.name, message: error.message };
  }

  if (typeof error === 'object') {
    const record = error as Record<string, unknown>;
    const message = typeof record.message === 'string' ? record.message : undefined;
    const name = typeof record.name === 'string' ? record.name : undefined;

    if (message || name) {
      return { name, message };
    }
  }

  return { message: String(error) };
}

function redactSensitive(payload: unknown): unknown {
  if (Array.isArray(payload)) {
    return payload.map(item => redactSensitive(item));
  }

  if (!isPlainObject(payload)) {
    return payload;
  }

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (BODY_REDACT_KEYS.has(key.toLowerCase())) {
      result[key] = REDACTED;
    } else {
      result[key] = redactSensitive(value);
    }
  }

  return result;
}

function truncatePayload(payload: unknown, maxLength: number): unknown {
  if (!Number.isFinite(maxLength) || maxLength <= 0) {
    return payload;
  }

  if (typeof payload === 'string') {
    return truncateString(payload, maxLength);
  }

  try {
    const json = JSON.stringify(payload);
    if (json.length <= maxLength) {
      return payload;
    }

    return {
      truncated: true,
      length: json.length,
      preview: json.slice(0, maxLength),
    };
  } catch {
    return payload;
  }
}

function truncateString(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength)}...[truncated]`;
}

function normalizePayload(payload: unknown): unknown {
  if (Buffer.isBuffer(payload)) {
    return `[Buffer ${payload.length} bytes]`;
  }

  if (payload instanceof Date) {
    return payload.toISOString();
  }

  return payload;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Object.prototype.toString.call(value) === '[object Object]';
}

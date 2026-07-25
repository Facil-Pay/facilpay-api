# Idempotency Key Support

## Overview

The payment creation endpoint supports idempotency keys to prevent duplicate payments when requests are retried.

## Usage

Include an `Idempotency-Key` header with a unique value when creating a payment:

```bash
curl -X POST http://localhost:3000/payments \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: a1b2c3d4-e5f6-7890-abcd-ef1234567890" \
  -d '{"amount":100,"currency":"USD","description":"Order #12345"}'
```

## Behavior

- **First request**: Creates a new payment and caches the response
- **Duplicate request** (same key + same body): Returns the cached response without creating a new payment
- **Mismatched request** (same key + different body): Returns 422 Unprocessable Entity
- **Expired key**: Keys expire after 24 hours (configurable via `IDEMPOTENCY_TTL_HOURS`)

## Bulk payments endpoint

The bulk creation endpoint `POST /payments/bulk` does not currently support idempotency keys. An `Idempotency-Key` header is not required for this route, and it is not used to deduplicate or retry the batch. If a bulk request is retried manually, it is treated as a fresh request.

```bash
curl -X POST http://localhost:3000/payments/bulk \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: bulk-key-123" \
  -d '[
    {"amount":100,"currency":"USD","description":"Order #1"},
    {"amount":200,"currency":"USD","description":"Order #2"}
  ]'
```

The request above is processed as a new bulk creation attempt. Duplicate items inside the same batch are not automatically deduplicated; each item is handled as part of the same atomic transaction, and the entire batch is rolled back if any item fails validation or processing.

## Configuration

Set the TTL in your `.env` file:

```env
IDEMPOTENCY_TTL_HOURS=24
```

## Examples

### Successful Retry

```bash
# First request
curl -X POST http://localhost:3000/payments \
  -H "Idempotency-Key: key-123" \
  -d '{"amount":100,"currency":"USD"}'
# Response: 201 Created, payment ID: abc-123

# Retry with same key and body
curl -X POST http://localhost:3000/payments \
  -H "Idempotency-Key: key-123" \
  -d '{"amount":100,"currency":"USD"}'
# Response: 201 Created, same payment ID: abc-123
```

### Key Reuse Error

```bash
# First request
curl -X POST http://localhost:3000/payments \
  -H "Idempotency-Key: key-456" \
  -d '{"amount":100,"currency":"USD"}'
# Response: 201 Created

# Retry with same key but different body
curl -X POST http://localhost:3000/payments \
  -H "Idempotency-Key: key-456" \
  -d '{"amount":200,"currency":"EUR"}'
# Response: 422 Unprocessable Entity
# Message: "Idempotency key reused with different request body"
```

## Cleanup

Expired rows are not removed by a background cron or scheduled Nest task. Cleanup happens in two ways:

1. **Lazy deletion on read** — When a request includes an `Idempotency-Key` that already exists but `expiresAt` is in the past, `IdempotencyService.checkKey()` deletes that row and treats the request as a new key (same as if the key were unknown).
2. **Bulk delete (optional)** — `IdempotencyService.cleanupExpired()` deletes all rows where `expiresAt` is before the current time. This method is not invoked automatically by the API; use it from maintenance scripts or ops tooling if you want to purge orphaned expired keys that are never looked up again.

There is no separate cleanup schedule or env var for cleanup timing. Expiry duration is controlled only by `IDEMPOTENCY_TTL_HOURS` (see [Configuration](#configuration)); that value sets `expiresAt` when a key is stored.

## Database

Idempotency keys are stored in the `idempotency_keys` table. The `expiresAt` column is indexed (`IDX_idempotency_keys_expiresAt`) to support efficient bulk deletes via `cleanupExpired()`.

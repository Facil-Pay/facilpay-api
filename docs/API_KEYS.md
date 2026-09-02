# API Keys

This document describes the API key lifecycle and usage history in FacilPay.

## Overview

API keys allow programmatic access to FacilPay endpoints. Each key belongs to a single user, has a unique secret, a set of scopes, an environment (`live` or `test`), and an optional expiry date. The full key secret is returned only once when the key is created or rotated.

## Key concepts

| Field | Description |
|---|---|
| `id` | UUID identifying the key. |
| `name` | Human-readable label. |
| `keyPrefix` | First 12 characters of the key, shown for reference. |
| `environment` | `live` or `test`. Determines the key prefix: `fp_live_` or `fp_test_`. |
| `scope` | Legacy broad scope (`read`, `write`, `admin`). |
| `scopes` | Granular scopes in `resource:action` format, e.g. `payments:read`. |
| `isActive` | `true` while the key can be used; set to `false` on revoke. |
| `expiresAt` | Optional ISO 8601 expiry date. |
| `lastUsedAt` | Timestamp of the most recent authenticated request. |
| `rateLimitLimit` / `rateLimitTtl` | Optional per-key rate-limit override. |
| `allowedIps` | Optional list of allowed IP addresses or CIDR ranges. |

## Endpoints

### Create an API key

```http
POST /v1/api-keys
Authorization: Bearer <token>
Content-Type: application/json
```

Request body:

```json
{
  "name": "My integration",
  "environment": "live",
  "scopes": ["payments:read", "payment-links:write"]
}
```

- `name` is required.
- `environment` defaults to `live`.
- `scope` defaults to `read` for backward compatibility.
- `scopes` is preferred over legacy `scope`.
- Response includes `apiKey` metadata and `plaintext`. Store `plaintext` securely — it is shown only once.

### List API keys

```http
GET /v1/api-keys
Authorization: Bearer <token>
```

Returns all active API keys for the authenticated user. Key hashes are never returned.

### Get a single API key

```http
GET /v1/api-keys/:id
Authorization: Bearer <token>
```

Returns metadata for a single active key. Key hashes are never returned.

### Update an API key

```http
PATCH /v1/api-keys/:id
Authorization: Bearer <token>
Content-Type: application/json
```

Request body:

```json
{
  "name": "Renamed key",
  "allowedIps": ["192.168.1.0/24"]
}
```

Updates the key name, scope, rate-limit override, or allowed IPs without regenerating the secret.

### Revoke an API key

```http
DELETE /v1/api-keys/:id
Authorization: Bearer <token>
```

Soft-revokes the key by setting `isActive` to `false`. The key can no longer authenticate requests.

### Rotate an API key

```http
POST /v1/api-keys/:id/rotate
Authorization: Bearer <token>
Content-Type: application/json
```

Revokes the existing key and creates a new one with the same name, scope, and environment. The new plaintext key is returned only once.

### Get usage history

```http
GET /v1/api-keys/:id/usage?page=1&limit=20
Authorization: Bearer <token>
```

Returns paginated usage records for the key:

```json
{
  "data": [
    {
      "id": "usage-uuid-1",
      "apiKeyId": "550e8400-e29b-41d4-a716-446655440000",
      "endpoint": "/v1/payments",
      "method": "POST",
      "sourceIp": "192.168.1.1",
      "userAgent": "Mozilla/5.0...",
      "statusCode": 201,
      "createdAt": "2026-07-28T10:00:00.000Z"
    }
  ],
  "total": 150,
  "page": 1,
  "limit": 20
}
```

Optional query parameters: `from`, `to` (ISO 8601 dates), `page`, `limit` (max 100).

## Lifecycle

1. **Create** — merchant generates a key with the desired scopes and environment.
2. **Use** — key is sent in the `Authorization` header for API requests.
3. **Monitor** — merchant lists keys and views usage history.
4. **Rotate or revoke** — when a key is compromised or no longer needed, rotate it (keeps config) or revoke it (disables access).

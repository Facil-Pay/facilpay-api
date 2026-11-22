# API Keys

## Optional signed requests

Set `requireSignedRequests: true` in `POST /v1/api-keys` to receive an independent
`signingSecret` alongside the one-time API key. Store both securely. The signing
secret is encrypted at rest with `API_KEY_SIGNING_ENCRYPTION_KEY` and excluded
from metadata responses. Keep this server encryption key stable across replicas.

`PATCH /v1/api-keys/:id` can enable signing for an existing key. When changing
from disabled to enabled, the update response includes a new `signingSecret`
once. Rotating a signed key returns a new API key and signing secret. Disabling
signing restores ordinary API key authentication.

Signed requests include these headers in addition to API key authentication:

| Header | Format |
| --- | --- |
| `X-FacilPay-Timestamp` | Unix timestamp in seconds (10 decimal digits) |
| `X-FacilPay-Signature` | HMAC-SHA256 digest as 64 hexadecimal characters |

The HMAC key is the independent signing secret, not the API key. The signed
string joins these four fields with newline characters, without a final newline:

1. Uppercase HTTP method.
2. Exact request path and query string, including query order and encoding.
3. The timestamp header exactly as sent.
4. Lowercase SHA-256 hexadecimal hash of the exact body bytes (empty bytes for no body).

Requests more than five minutes in the past or future are rejected with 401.
Signatures are compared in constant time. The time window limits replay;
identical signed requests can be replayed within the window, so payment writes
should also use their existing idempotency keys. Proxies must preserve the
request path, query string, and body bytes used by the client. Nest bootstrap
enables `rawBody` capture for verification.

Node.js signing helper (built-in `node:crypto`, Node.js with `fetch`):

```js
const { createHash, createHmac } = require('node:crypto');

function signedHeaders({ apiKey, signingSecret, method, path, body = '' }) {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const hash = createHash('sha256').update(body).digest('hex');
  const canonical = [method.toUpperCase(), path, timestamp, hash].join('\n');
  const signature = createHmac('sha256', signingSecret)
    .update(canonical).digest('hex');
  return {
    'X-API-Key': apiKey,
    'X-FacilPay-Timestamp': timestamp,
    'X-FacilPay-Signature': signature,
    'Content-Type': 'application/json',
  };
}

const path = '/v1/hooks/subscribe';
const body = JSON.stringify({
  url: 'https://hooks.example.com/facilpay',
  events: ['payment.completed'],
});
fetch(`https://api.facilpay.com${path}`, {
  method: 'POST',
  headers: signedHeaders({
    apiKey: process.env.FACILPAY_API_KEY,
    signingSecret: process.env.FACILPAY_SIGNING_SECRET,
    method: 'POST', path, body,
  }),
  body, // Send exactly the bytes that were signed.
});
```

Third-party apps can use scoped, revocable [OAuth authorization](OAUTH.md)
instead of receiving the merchant's API key.

## Overview

API keys enable programmatic access to the FacilPay API for merchants. Each API key can be scoped to specific endpoints and configured for sandbox or production environments. Keys support rotation for security purposes without service disruption.

---

## API Key Object

```json
{
  "id": "key_abc123def456",
  "merchantId": "merchant-uuid",
  "name": "Production Integration",
  "environment": "PRODUCTION",
  "scopes": [
    "payments:read",
    "payments:write",
    "invoices:read",
    "webhooks:read"
  ],
  "lastUsedAt": "2026-01-15T14:30:00.000Z",
  "createdAt": "2026-01-10T10:30:00.000Z",
  "updatedAt": "2026-01-10T10:30:00.000Z"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `id` | String | Unique API key identifier (prefixed with `key_`) |
| `merchantId` | UUID | Owner merchant identifier |
| `name` | String | Human-readable key name |
| `environment` | String | Either `SANDBOX` or `PRODUCTION` |
| `scopes` | Array | List of authorized scopes (see Scopes section) |
| `lastUsedAt` | Date | Timestamp of last API request using this key |
| `createdAt` | Date | Key creation timestamp |
| `updatedAt` | Date | Last update timestamp |

---

## Available Scopes

Scopes follow a hierarchical naming convention: `resource:action`

| Scope | Description |
|-------|-------------|
| `payments:read` | Read payment information |
| `payments:write` | Create and update payments |
| `invoices:read` | Read invoice data |
| `invoices:write` | Create and update invoices |
| `refunds:read` | Read refund information |
| `refunds:write` | Create refunds |
| `webhooks:read` | Read webhook configuration |
| `webhooks:write` | Create and update webhooks |
| `reports:read` | Read financial reports |
| `customers:read` | Read customer information |
| `customers:write` | Create and update customers |
| `disputes:read` | Read dispute information |
| `disputes:write` | Respond to disputes |
| `api-keys:read` | List and view API keys |
| `api-keys:write` | Create, update, and rotate API keys |

---

## API Endpoints

### POST /v1/api-keys

Create a new API key.

**Authentication**: JWT Bearer token required

**Request**:
```http
POST /v1/api-keys HTTP/1.1
Host: api.facilpay.com
Authorization: Bearer <jwt_token>
Content-Type: application/json

{
  "name": "Production Integration",
  "environment": "PRODUCTION",
  "scopes": [
    "payments:read",
    "payments:write",
    "invoices:read"
  ]
}
```

**Response** (201 Created):
```json
{
  "id": "key_abc123def456",
  "merchantId": "merchant-uuid",
  "name": "Production Integration",
  "environment": "PRODUCTION",
  "scopes": [
    "payments:read",
    "payments:write",
    "invoices:read"
  ],
  "plaintext": "sk_live_abc123def456xyz789",
  "createdAt": "2026-01-15T10:30:00.000Z"
}
```

**Important**: The `plaintext` key is only returned during creation. Store it securely immediately—it cannot be retrieved later.

---

### GET /v1/api-keys

List all API keys for the current merchant.

**Authentication**: JWT Bearer token required

**Response** (200 OK):
```json
[
  {
    "id": "key_abc123def456",
    "merchantId": "merchant-uuid",
    "name": "Production Integration",
    "environment": "PRODUCTION",
    "scopes": [
      "payments:read",
      "payments:write",
      "invoices:read"
    ],
    "lastUsedAt": "2026-01-15T14:30:00.000Z",
    "createdAt": "2026-01-10T10:30:00.000Z",
    "updatedAt": "2026-01-10T10:30:00.000Z"
  }
]
```

---

### GET /v1/api-keys/:id

Retrieve details of a specific API key.

**Authentication**: JWT Bearer token required

**Response** (200 OK):
```json
{
  "id": "key_abc123def456",
  "merchantId": "merchant-uuid",
  "name": "Production Integration",
  "environment": "PRODUCTION",
  "scopes": [
    "payments:read",
    "payments:write",
    "invoices:read"
  ],
  "lastUsedAt": "2026-01-15T14:30:00.000Z",
  "createdAt": "2026-01-10T10:30:00.000Z",
  "updatedAt": "2026-01-10T10:30:00.000Z"
}
```

**Error Responses**:
- `404 Not Found`: API key does not exist or is not owned by the merchant
- `401 Unauthorized`: Missing or invalid authentication token

---

### POST /v1/api-keys/:id/rotate

Rotate an API key by revoking the current key and creating a new one with identical scopes and environment settings.

**Authentication**: JWT Bearer token required

**Why Rotate?**
- Security best practice after potential exposure
- Periodic rotation as part of security policy
- Key compromise or suspicion of unauthorized access

**Request**:
```http
POST /v1/api-keys/:id/rotate HTTP/1.1
Host: api.facilpay.com
Authorization: Bearer <jwt_token>
```

**Response** (200 OK):
```json
{
  "id": "key_xyz789abc123",
  "merchantId": "merchant-uuid",
  "name": "Production Integration",
  "environment": "PRODUCTION",
  "scopes": [
    "payments:read",
    "payments:write",
    "invoices:read"
  ],
  "plaintext": "sk_live_xyz789abc123def456",
  "createdAt": "2026-01-15T15:00:00.000Z"
}
```

**Key Points**:
- Returns a completely new API key with a new ID and plaintext value
- Old key is immediately revoked (no grace period)
- Name, scopes, and environment are preserved
- Integration must update to use the new key immediately
- Old key cannot be reactivated

**Error Responses**:
- `400 Bad Request`: Key already revoked or invalid state
- `404 Not Found`: API key does not exist
- `401 Unauthorized`: Missing or invalid authentication token

---

### DELETE /v1/api-keys/:id

Revoke an API key immediately. (Future endpoint)

**Authentication**: JWT Bearer token required

**Response** (204 No Content)

---

## Using API Keys

### HTTP Header Authentication

Include the API key in the `X-API-Key` header:

```bash
curl https://api.facilpay.com/v1/payments \
  -H "X-API-Key: sk_live_abc123def456xyz789"
```

### Bearer Token (Alternative)

Include the API key as a Bearer token:

```bash
curl https://api.facilpay.com/v1/payments \
  -H "Authorization: Bearer sk_live_abc123def456xyz789"
```

---

## Best Practices

### Security

1. **Store securely**: Never commit API keys to version control
2. **Use environment variables**:
   ```bash
   export FACILPAY_API_KEY="sk_live_abc123def456xyz789"
   ```
3. **Rotate periodically**: Rotate keys at least annually
4. **Rotate on compromise**: Immediately rotate if key is exposed
5. **Principle of least privilege**: Use the minimum required scopes

### Scoping

- Create separate keys for different environments (sandbox vs. production)
- Create separate keys for different integrations
- Restrict scopes to only what the integration needs

### Monitoring

- Monitor `lastUsedAt` to identify unused keys
- Set up alerts for failed authentication attempts
- Review key usage patterns for anomalies

### Example: Rotating Compromised Key

1. Identify the compromised key ID
2. Call the rotation endpoint:
   ```bash
   curl -X POST https://api.facilpay.com/v1/api-keys/key_abc123/rotate \
     -H "Authorization: Bearer <jwt_token>"
   ```
3. Store the new plaintext key in your secure configuration
4. Update your application to use the new key
5. Restart services to pick up the new key

---

## Rate Limiting

API key endpoints follow standard merchant rate limits:
- POST /api-keys: 5 per minute
- GET /api-keys: 30 per minute
- POST /api-keys/:id/rotate: 3 per minute

---

## Error Handling

### Invalid Scope

```json
{
  "statusCode": 400,
  "message": "Invalid scope: 'payments:delete'",
  "error": "Bad Request"
}
```

### Unauthorized Access

```json
{
  "statusCode": 403,
  "message": "You do not own this API key",
  "error": "Forbidden"
}
```

### Rate Limited

```json
{
  "statusCode": 429,
  "message": "Too many requests. Please retry after 60 seconds.",
  "error": "Too Many Requests"
}
```

---

## Webhooks

When an API key is rotated, a webhook event is sent:

```json
{
  "id": "webhook_event_uuid",
  "type": "api_key.rotated",
  "data": {
    "apiKeyId": "key_abc123def456",
    "newKeyId": "key_xyz789abc123",
    "rotatedAt": "2026-01-15T15:00:00.000Z"
  },
  "createdAt": "2026-01-15T15:00:00.000Z"
}
```

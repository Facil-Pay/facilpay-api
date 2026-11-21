# API Keys

## Overview

API keys enable programmatic access to the FacilPay API for merchants and third-party integrations. Each API key can be scoped to specific endpoints and configured for sandbox or production environments. Keys support rotation for security purposes without service disruption.

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
  "keyPrefix": "fp_live_abc12",
  "isActive": true,
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
| `keyPrefix` | String | First 12 characters of key for display |
| `isActive` | Boolean | Whether the key is currently active |
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
  "keyPrefix": "fp_live_abc12",
  "plaintext": "fp_live_abc123def456xyz789abcdefghij",
  "isActive": true,
  "createdAt": "2026-01-15T10:30:00.000Z"
}
```

**Important**: The `plaintext` key is only returned during creation. Store it securely immediately—it cannot be retrieved later.

---

### GET /v1/api-keys

List all API keys for the current merchant.

**Authentication**: JWT Bearer token required

**Query Parameters**:
- `active` (boolean, optional): Filter by active status (default: all)
- `environment` (string, optional): Filter by environment (SANDBOX or PRODUCTION)

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
    "keyPrefix": "fp_live_abc12",
    "isActive": true,
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
  "keyPrefix": "fp_live_abc12",
  "isActive": true,
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
  "keyPrefix": "fp_live_xyz78",
  "plaintext": "fp_live_xyz789abc123def456ghijklmno",
  "isActive": true,
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

### PATCH /v1/api-keys/:id

Update an API key's name or scopes (except for rotation).

**Authentication**: JWT Bearer token required

**Request**:
```http
PATCH /v1/api-keys/:id HTTP/1.1
Host: api.facilpay.com
Authorization: Bearer <jwt_token>
Content-Type: application/json

{
  "name": "Updated Key Name",
  "scopes": ["payments:read", "payments:write"]
}
```

**Response** (200 OK):
```json
{
  "id": "key_abc123def456",
  "name": "Updated Key Name",
  "scopes": ["payments:read", "payments:write"],
  "updatedAt": "2026-01-15T16:00:00.000Z"
}
```

---

### DELETE /v1/api-keys/:id

Revoke an API key immediately.

**Authentication**: JWT Bearer token required

**Response** (204 No Content)

**Note**: Revoked keys cannot be reactivated. Use rotation if you need a new key with the same settings.

---

## Using API Keys

### HTTP Header Authentication

Include the API key in the `X-API-Key` header:

```bash
curl https://api.facilpay.com/v1/payments \
  -H "X-API-Key: fp_live_abc123def456xyz789abcdefghij"
```

### Bearer Token (Alternative)

Include the API key as a Bearer token:

```bash
curl https://api.facilpay.com/v1/payments \
  -H "Authorization: Bearer fp_live_abc123def456xyz789abcdefghij"
```

---

## Best Practices

### Security

1. **Store securely**: Never commit API keys to version control
2. **Use environment variables**:
   ```bash
   export FACILPAY_API_KEY="fp_live_abc123def456xyz789abcdefghij"
   ```
3. **Rotate periodically**: Rotate keys at least annually
4. **Rotate on compromise**: Immediately rotate if key is exposed
5. **Principle of least privilege**: Use the minimum required scopes
6. **Separate keys per environment**: Never use production keys in testing

### Scoping

- Create separate keys for different environments (sandbox vs. production)
- Create separate keys for different integrations or services
- Restrict scopes to only what the integration needs
- Regularly audit key usage via the `lastUsedAt` field

### Monitoring

- Monitor `lastUsedAt` to identify unused keys
- Set up alerts for failed authentication attempts
- Review key usage patterns for anomalies
- Implement rotation reminders for old keys

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

## Environment-Specific Behavior

### Sandbox Environment

- Use `environment: "SANDBOX"` when creating keys
- Keys prefixed with `fp_test_`
- Test against sandbox payment processors
- No real charges occur

### Production Environment

- Use `environment: "PRODUCTION"` when creating keys
- Keys prefixed with `fp_live_`
- Process real transactions
- Subject to rate limiting and monitoring

---

## Rate Limiting

API key endpoints follow standard rate limits:
- POST /api-keys: 5 per minute
- GET /api-keys: 30 per minute
- POST /api-keys/:id/rotate: 3 per minute
- DELETE /api-keys/:id: 5 per minute

API requests authenticated with an API key are subject to standard merchant rate limits.

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

### Key Not Found

```json
{
  "statusCode": 404,
  "message": "API key not found",
  "error": "Not Found"
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

When an API key is rotated, a webhook event is sent (if configured):

```json
{
  "id": "webhook_event_uuid",
  "type": "api_key.rotated",
  "data": {
    "apiKeyId": "key_abc123def456",
    "newKeyId": "key_xyz789abc123",
    "rotatedAt": "2026-01-15T15:00:00.000Z",
    "rotatedBy": "user-id"
  },
  "createdAt": "2026-01-15T15:00:00.000Z"
}
```

When an API key is revoked:

```json
{
  "id": "webhook_event_uuid",
  "type": "api_key.revoked",
  "data": {
    "apiKeyId": "key_abc123def456",
    "revokedAt": "2026-01-15T16:00:00.000Z",
    "revokedBy": "user-id"
  },
  "createdAt": "2026-01-15T16:00:00.000Z"
}
```

Configure webhooks to receive these events. See [WEBHOOKS.md](./WEBHOOKS.md) for more information.

---

## Troubleshooting

### "Invalid API key" Error

- Verify the key is active (not revoked)
- Check that the key belongs to the correct merchant
- Ensure the key environment matches your target environment (sandbox vs. production)
- Verify the key hasn't expired

### "Insufficient scopes" Error

- The API key doesn't have the required scope
- Use the PATCH endpoint to add the necessary scope
- Consider creating a new key with all needed scopes

### "API key not found" Error

- The key has been deleted or revoked
- Verify you're using the correct key ID
- Create a new API key if needed

---

## Migration from Legacy Authentication

If you're migrating from another authentication method:

1. Create new API keys for your integration
2. Update your application code to use the new keys
3. Test thoroughly in sandbox environment
4. Deploy to production
5. Revoke the old authentication method
6. Monitor for any issues with the new integration

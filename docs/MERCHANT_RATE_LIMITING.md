# Per-Merchant Rate Limiting Implementation

## Overview

This implementation extends the existing throttler module to support per-merchant rate limit configuration instead of a global rate limit. Merchants can now have custom rate limits stored in their profile, which are enforced per API key or JWT identity.

## Implementation Details

### 1. Extended ThrottlerGuard

**File:** `src/modules/throttler/merchant-throttler.guard.ts`

Created a custom `MerchantThrottlerGuard` that extends NestJS's `ThrottlerGuard` to:
- Extract merchant/user identifier from requests (supports both JWT and API key authentication)
- Fetch user-specific rate limit configuration from the database
- Apply custom rate limits when enabled for the user
- Fall back to global defaults when custom limits are not configured or when the user service fails

**Key Features:**
- Supports both JWT and API key authentication
- Graceful fallback to global defaults on errors
- Custom TTL and limit per merchant
- No breaking changes to existing rate limiting

### 2. User Entity Updates

**File:** `src/modules/users/user.entity.ts`

Added three new columns to the `User` entity:
- `rateLimitEnabled` (boolean): Flag to enable/disable custom rate limits
- `rateLimitLimit` (integer, nullable): Custom request limit per time window
- `rateLimitTtl` (integer, nullable): Custom time window in milliseconds

### 3. Database Migration

**File:** `src/migrations/1751500000000-AddRateLimitColumnsToUsers.ts`

Created a migration to add the new rate limit columns to the `users` table with appropriate defaults.

### 4. DTOs for Rate Limit Configuration

**File:** `src/modules/users/dto/update-rate-limit.dto.ts`

Created `UpdateRateLimitDto` with validation rules:
- `rateLimitEnabled`: Boolean flag
- `rateLimitLimit`: Integer between 1 and 10,000
- `rateLimitTtl`: Integer between 1,000ms (1 second) and 86,400,000ms (24 hours)

### 5. Service Method

**File:** `src/modules/users/users.service.ts`

Added `updateRateLimit()` method to:
- Update rate limit configuration for a specific user
- Log configuration changes
- Return updated user data (excluding password)

### 6. Admin Endpoint

**File:** `src/modules/users/users.controller.ts`

Added new endpoint:
- **PATCH** `/v1/users/:id/rate-limit`
- **Guards:** JWT Auth + Roles (ADMIN only)
- **Purpose:** Update rate limit configuration for any user

**Example Request:**
```json
{
  "rateLimitEnabled": true,
  "rateLimitLimit": 200,
  "rateLimitTtl": 60000
}
```

### 7. Unit Tests

**File:** `src/modules/throttler/merchant-throttler.guard.spec.ts`

Comprehensive test suite covering:
- Default rate limiting behavior
- Custom merchant rate limiting
- API key authentication with custom limits
- Rate limit headers verification
- Edge cases (no auth, service failures, partial configs)

## Configuration

### Global Rate Limits (Default)

Configured in `src/modules/throttler/throttler.config.module.ts`:
- **default**: 100 requests per minute
- **auth**: 5 requests per 15 minutes
- **bulk**: 20 requests per minute
- **webhook**: 1000 requests per minute

### Per-Merchant Rate Limits

Merchants can override global limits by setting:
- `rateLimitEnabled`: true
- `rateLimitLimit`: Custom limit (e.g., 200 requests)
- `rateLimitTtl`: Custom time window (e.g., 60000ms = 1 minute)

## Usage

### Enabling Custom Rate Limits for a Merchant

**As Admin:**
```bash
curl -X PATCH https://api.example.com/v1/users/{userId}/rate-limit \
  -H "Authorization: Bearer {admin-jwt-token}" \
  -H "Content-Type: application/json" \
  -d '{
    "rateLimitEnabled": true,
    "rateLimitLimit": 200,
    "rateLimitTtl": 60000
  }'
```

### Disabling Custom Rate Limits

```bash
curl -X PATCH https://api.example.com/v1/users/{userId}/rate-limit \
  -H "Authorization: Bearer {admin-jwt-token}" \
  -H "Content-Type: application/json" \
  -d '{
    "rateLimitEnabled": false
  }'
```

## Rate Limit Headers

All responses include standard rate limit headers:
- `X-RateLimit-Limit`: Maximum requests allowed in current window
- `X-RateLimit-Remaining`: Remaining requests in current window
- `X-RateLimit-Reset`: Time when the rate limit resets (ISO 8601 format)

## Acceptance Criteria Checklist

- ✅ Merchants can have custom rate limits stored in their profile
- ✅ Rate limits enforced per API key or JWT identity
- ✅ Default rate limit applied when no custom limit set
- ✅ Rate limit headers returned in responses (X-RateLimit-*)
- ✅ Admin endpoint to update merchant rate limits
- ✅ Unit tests for custom throttler guard

## Technical Notes

- The `MerchantThrottlerGuard` extends `ThrottlerGuard` and overrides key methods to inject merchant-specific limits
- Rate limit configuration is stored directly on the user entity for simplicity
- The guard gracefully handles database errors by falling back to global defaults
- No changes required to existing controllers or decorators
- Backward compatible - existing rate limiting continues to work without configuration changes

## Migration

To apply the database migration:

```bash
cd facilpay-api
npm run migrate
```

Or using Docker:
```bash
docker compose run --rm api migrate
```

## Testing

Run the unit tests for the merchant throttler guard:

```bash
cd facilpay-api
npm test -- merchant-throttler.guard.spec.ts
```

Or run all tests:
```bash
npm test
# Checkout Sessions

## Overview

Checkout sessions provide a hosted, one-time payment page for collecting payments without building a custom checkout form. Merchants create a session with line items and redirect URLs, then send the payer to a public checkout page using the `publicId`.

Sessions have a status lifecycle: `OPEN` → `COMPLETE` or `EXPIRED`. Merchants can manually expire open sessions.

---

## Session Object

```json
{
  "id": "123e4567-e89b-12d3-a456-426614174000",
  "publicId": "abc123def456",
  "merchantId": "abc123-merchant-uuid",
  "lineItems": [
    {
      "productId": "prod_123",
      "name": "Product 1",
      "description": "A great product",
      "quantity": 2,
      "unitAmount": 1000
    }
  ],
  "currency": "USD",
  "total": 2500,
  "subtotal": 2000,
  "discountAmount": 0,
  "shippingAddressCollection": { "allowedCountries": ["US", "CA"] },
  "shippingOptions": [
    { "id": "standard", "label": "Standard shipping", "amount": 500 }
  ],
  "shippingAddress": null,
  "shippingOptionId": null,
  "shippingAmount": 500,
  "customerId": "cus_123",
  "customerEmail": "customer@example.com",
  "successUrl": "https://example.com/success",
  "cancelUrl": "https://example.com/cancel",
  "expiresAt": "2026-10-17T12:00:00.000Z",
  "status": "OPEN",
  "paymentId": null,
  "createdAt": "2026-10-17T10:30:00.000Z",
  "updatedAt": "2026-10-17T10:30:00.000Z"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `id` | UUID | Internal session identifier |
| `publicId` | String | Public-facing ID for payer URLs (32-character alphanumeric) |
| `merchantId` | UUID | Owner merchant identifier |
| `lineItems` | Array | List of line items (see LineItem schema below) |
| `currency` | String | ISO 4217 currency code (e.g., `USD`) |
| `subtotal` | Number | Line-item total before discount and shipping |
| `discountAmount` | Number | Coupon discount in smallest currency unit |
| `shippingAddressCollection` | Object | Shipping address settings (see below), or `null` |
| `shippingOptions` | Array | Fixed shipping rates available for the session |
| `shippingAddress` | Object | Address submitted by the payer, or `null` |
| `shippingOptionId` | String | Selected shipping option id, or `null` |
| `shippingAmount` | Number | Selected shipping rate in smallest currency unit |
| `total` | Number | `subtotal - discountAmount + shippingAmount` |
| `customerId` | String | Optional customer ID from merchant system |
| `customerEmail` | String | Optional customer email |
| `successUrl` | String | Redirect URL on successful payment |
| `cancelUrl` | String | Redirect URL when payer cancels |
| `expiresAt` | Timestamp | Session expiry time |
| `status` | Enum | Session status: `OPEN`, `COMPLETE`, `EXPIRED` |
| `paymentId` | UUID | Associated payment ID (null until payment is created) |
| `createdAt` | Timestamp | Creation timestamp |
| `updatedAt` | Timestamp | Last update timestamp |

### LineItem Schema

```json
{
  "productId": "prod_123",
  "name": "Product 1",
  "description": "A great product",
  "quantity": 2,
  "unitAmount": 1000
}
```

| Field | Type | Description |
|-------|------|-------------|
| `productId` | String | Optional product ID from catalog |
| `name` | String | Item name (max 200 characters, optional if `productId` is provided) |
| `description` | String | Item description (max 500 characters, optional) |
| `quantity` | Number | Quantity (positive integer) |
| `unitAmount` | Number | Unit amount in smallest currency unit (optional if `productId` is provided) |

### Shipping schemas

`shippingAddressCollection` opts the session into address collection:

```json
{ "allowedCountries": ["US", "CA"] }
```

- `allowedCountries` — ISO 3166-1 alpha-2 codes. An empty array allows any valid country.
  Addresses whose country is outside a non-empty allowlist are rejected.

`shippingOptions` is an optional list of fixed rates:

```json
[
  { "id": "standard", "label": "Standard shipping", "amount": 500 },
  { "id": "express", "label": "Express shipping", "amount": 1200 }
]
```

- `id` — unique identifier (max 64 characters), used when submitting the address
- `label` — payer-facing label (max 100 characters)
- `amount` — non-negative integer in the smallest currency unit

A rate can be preselected at creation with `shippingOptionId`. Otherwise the payer
selects one when submitting the address. The selected amount is included in `total`
and reported separately as `shippingFormatted` on public responses.

`shippingAddress` has the following shape:

```json
{
  "name": "Jane Doe",
  "line1": "123 Main St",
  "line2": "Apt 4B",
  "city": "New York",
  "state": "NY",
  "postalCode": "10001",
  "country": "US"
}
```

`line1`, `city`, `postalCode` and `country` are required. `country` must be a valid
ISO 3166-1 alpha-2 code. The address is stored on the session and copied to the
customer record (created when needed) when the session completes.

---

## Session Status

| Status | Description |
|--------|-------------|
| `OPEN` | Session is active and awaiting payment |
| `COMPLETE` | Payment was successfully completed |
| `EXPIRED` | Session expired (either manually or automatically after `expiresAt`) |

---

## Create a Checkout Session

```
POST /v1/checkout/sessions
Authorization: Bearer <access_token>
```

**Request Body:**
```json
{
  "lineItems": [
    {
      "productId": "prod_123",
      "name": "Product 1",
      "description": "A great product",
      "quantity": 2,
      "unitAmount": 1000
    },
    {
      "name": "Product 2",
      "quantity": 1,
      "unitAmount": 1500
    }
  ],
  "currency": "USD",
  "customerId": "cus_123",
  "customerEmail": "customer@example.com",
  "successUrl": "https://example.com/success",
  "cancelUrl": "https://example.com/cancel",
  "expiresInMinutes": 30,
  "shippingAddressCollection": { "allowedCountries": ["US", "CA"] },
  "shippingOptions": [
    { "id": "standard", "label": "Standard shipping", "amount": 500 }
  ],
  "shippingOptionId": "standard"
}
```

- `lineItems` (required) — Array of line items. Each item must have `quantity` and either `name`+`unitAmount` or `productId`.
- `currency` (required) — ISO 4217 currency code (e.g., `USD`, `EUR`).
- `customerId` (optional) — Customer ID from merchant system (max 200 characters).
- `customerEmail` (optional) — Customer email address.
- `successUrl` (required) — Redirect URL on successful payment.
- `cancelUrl` (required) — Redirect URL when payer cancels.
- `expiresInMinutes` (optional) — Session expiry in minutes (default: 30, min: 5, max: 1440).
- `shippingAddressCollection` (optional) — Enables shipping address collection and restricts delivery countries.
- `shippingOptions` (optional) — Up to 20 fixed shipping rates added to the total when selected.
- `shippingOptionId` (optional) — Preselects one of the `shippingOptions` at creation; its amount is added to the total immediately.

**Response (200 OK):**
```json
{
  "id": "123e4567-e89b-12d3-a456-426614174000",
  "publicId": "abc123def456",
  "merchantId": "abc123-merchant-uuid",
  "lineItems": [
    {
      "productId": "prod_123",
      "name": "Product 1",
      "description": "A great product",
      "quantity": 2,
      "unitAmount": 1000
    },
    {
      "name": "Product 2",
      "quantity": 1,
      "unitAmount": 1500
    }
  ],
  "currency": "USD",
  "total": 3500,
  "customerId": "cus_123",
  "customerEmail": "customer@example.com",
  "successUrl": "https://example.com/success",
  "cancelUrl": "https://example.com/cancel",
  "expiresAt": "2026-10-17T11:00:00.000Z",
  "status": "OPEN",
  "paymentId": null,
  "createdAt": "2026-10-17T10:30:00.000Z",
  "updatedAt": "2026-10-17T10:30:00.000Z"
}
```

The payer URL is: `https://yourdomain.com/checkout/{publicId}`

**Response (400 Bad Request):**
```json
{
  "statusCode": 400,
  "message": [
    "lineItems must be an array",
    "currency must be a valid ISO 4217 currency code"
  ],
  "error": "Bad Request"
}
```

**Response (401 Unauthorized):**
```json
{
  "statusCode": 401,
  "message": "Missing or invalid JWT",
  "error": "Unauthorized"
}
```

---

## List Checkout Sessions

```
GET /v1/checkout/sessions?limit=20&offset=0
Authorization: Bearer <access_token>
```

Returns all checkout sessions for the authenticated merchant.

**Query Parameters:**
- `limit` (optional) — Number of sessions to return (default: 20)
- `offset` (optional) — Number of sessions to skip (default: 0)

**Response (200 OK):**
```json
{
  "sessions": [
    {
      "id": "123e4567-e89b-12d3-a456-426614174000",
      "publicId": "abc123def456",
      "merchantId": "abc123-merchant-uuid",
      "lineItems": [...],
      "currency": "USD",
      "total": 2000,
      "status": "OPEN",
      "createdAt": "2026-10-17T10:30:00.000Z"
    }
  ],
  "total": 1
}
```

**Response (401 Unauthorized):**
```json
{
  "statusCode": 401,
  "message": "Missing or invalid JWT",
  "error": "Unauthorized"
}
```

---

## Get a Checkout Session

```
GET /v1/checkout/sessions/:id
Authorization: Bearer <access_token>
```

Returns a checkout session by its internal ID. Only returns sessions owned by the authenticated merchant.

**Response (200 OK):**
```json
{
  "id": "123e4567-e89b-12d3-a456-426614174000",
  "publicId": "abc123def456",
  "merchantId": "abc123-merchant-uuid",
  "lineItems": [...],
  "currency": "USD",
  "total": 2000,
  "successUrl": "https://example.com/success",
  "cancelUrl": "https://example.com/cancel",
  "expiresAt": "2026-10-17T11:00:00.000Z",
  "status": "OPEN",
  "paymentId": null,
  "createdAt": "2026-10-17T10:30:00.000Z",
  "updatedAt": "2026-10-17T10:30:00.000Z"
}
```

**Response (404 Not Found):**
```json
{
  "statusCode": 404,
  "message": "Session not found",
  "error": "Not Found"
}
```

Sessions owned by other merchants return 404.

**Response (401 Unauthorized):**
```json
{
  "statusCode": 401,
  "message": "Missing or invalid JWT",
  "error": "Unauthorized"
}
```

---

## Expire a Checkout Session

```
POST /v1/checkout/sessions/:id/expire
Authorization: Bearer <access_token>
```

Manually expires an `OPEN` checkout session. Sessions in `COMPLETE` or `EXPIRED` status cannot be expired.

**Response (200 OK):**
```json
{
  "id": "123e4567-e89b-12d3-a456-426614174000",
  "publicId": "abc123def456",
  "status": "EXPIRED",
  "expiresAt": "2026-10-17T11:00:00.000Z",
  "updatedAt": "2026-10-17T10:45:00.000Z"
}
```

**Response (400 Bad Request):**
```json
{
  "statusCode": 400,
  "message": "Session is not open or already expired",
  "error": "Bad Request"
}
```

**Response (404 Not Found):**
```json
{
  "statusCode": 404,
  "message": "Session not found",
  "error": "Not Found"
}
```

**Response (401 Unauthorized):**
```json
{
  "statusCode": 401,
  "message": "Missing or invalid JWT",
  "error": "Unauthorized"
}
```

---

## Public Checkout Page

```
GET /v1/checkout/sessions/:publicId/public
```

Returns public checkout session info for payers. **No authentication required.**

**Response (200 OK):**
```json
{
  "merchantDisplayName": "My Store",
  "merchantLogo": "https://storage.example.com/logo.png",
  "primaryColor": "#1a1a2e",
  "lineItems": [
    {
      "name": "Product 1",
      "quantity": 2,
      "unitAmount": 1000
    }
  ],
  "subtotalFormatted": "USD 50.00",
  "discountFormatted": "USD 0.00",
  "shippingFormatted": "USD 5.00",
  "totalFormatted": "USD 55.00",
  "shippingAddressCollection": { "allowedCountries": ["US", "CA"] },
  "shippingOptions": [
    { "id": "standard", "label": "Standard shipping", "amount": 500 }
  ],
  "shippingAddress": null,
  "shippingOptionId": "standard",
  "status": "OPEN",
  "isExpired": false,
  "successUrl": "https://example.com/success",
  "cancelUrl": "https://example.com/cancel"
}
```

- `merchantDisplayName` — Merchant branding display name
- `merchantLogo` — Merchant logo URL (nullable)
- `primaryColor` — Merchant primary brand color
- `lineItems` — Line items for the session
- `subtotalFormatted` / `discountFormatted` — Line-item total and coupon discount, formatted
- `shippingFormatted` — Shipping amount formatted separately from the subtotal
- `totalFormatted` — Human-readable total including shipping (e.g., `USD 55.00`)
- `shippingAddressCollection` / `shippingOptions` — Shipping configuration for the payer UI
- `shippingAddress` / `shippingOptionId` — Address and rate submitted so far (`null` before submission)
- `status` — Session status (`OPEN`, `COMPLETE`, `EXPIRED`)
- `isExpired` — Whether the session is expired (status is `EXPIRED` or past `expiresAt`)
- `successUrl` — Success redirect URL
- `cancelUrl` — Cancel redirect URL

**Response (404 Not Found):**
```json
{
  "statusCode": 404,
  "message": "Session not found",
  "error": "Not Found"
}
```

**Response (410 Gone):**
```json
{
  "statusCode": 410,
  "message": "Session has expired",
  "error": "Gone"
}
```

---

## Submit a Shipping Address

```
POST /v1/checkout/sessions/:publicId/shipping-address
```

Available only when the session was created with `shippingAddressCollection`.
**No authentication required.**

**Request Body:**
```json
{
  "shippingAddress": {
    "name": "Jane Doe",
    "line1": "123 Main St",
    "city": "New York",
    "state": "NY",
    "postalCode": "10001",
    "country": "US"
  },
  "shippingOptionId": "standard"
}
```

- `shippingAddress` (required) — `line1`, `city`, `postalCode` and ISO alpha-2 `country` are required.
- `shippingOptionId` (required when the session offers shipping options and none was preselected).

**Response (200 OK):**
```json
{
  "subtotalFormatted": "USD 50.00",
  "discountFormatted": "USD 0.00",
  "shippingFormatted": "USD 5.00",
  "totalFormatted": "USD 55.00",
  "shippingAddress": {
    "name": "Jane Doe",
    "line1": "123 Main St",
    "city": "New York",
    "state": "NY",
    "postalCode": "10001",
    "country": "US"
  },
  "shippingOptionId": "standard"
}
```

**Response (400 Bad Request):**
```json
{
  "statusCode": 400,
  "message": "Shipping to 'FR' is not allowed for this checkout session",
  "error": "Bad Request"
}
```

The address is validated (required fields, ISO country code and allowlist), stored on
the session and copied to the customer when the session completes. The shipping amount
is reported on its own line and included in the total and in the
`checkout.session.completed` webhook payload.

---

## Session Expiry

Sessions have a default expiry of **30 minutes** after creation (configurable via `expiresInMinutes`). When a session expires:

1. The status transitions to `EXPIRED`.
2. The public checkout page shows an expiry message.
3. No payment can be created for the session.

Sessions can be expired manually via `POST /v1/checkout/sessions/:id/expire`.

---

## Currency Handling

The `currency` field accepts ISO 4217 codes (e.g., `USD`, `EUR`, `GBP`). The total is calculated automatically from line items:

```
subtotal = sum(lineItem.quantity * lineItem.unitAmount)
total    = subtotal - discountAmount + shippingAmount
```

Shipping is never discounted. It is shown separately as `shippingFormatted` in all
public checkout responses and in the completion webhook payload.

Amounts are in the smallest currency unit:
- `USD`: cents (1000 = $10.00)
- `EUR`: cents (1000 = €10.00)
- `JPY`: yen (1000 = ¥1000, no decimal subdivision)

See [RATES.md](RATES.md) for more on currency handling.

---

## Complete curl Walkthrough

```bash
# 1. Log in to get an access token
ACCESS_TOKEN=$(curl -s -X POST http://localhost:3000/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"merchant@example.com","password":"P@ssw0rd!"}' \
  | jq -r '.access_token')

# 2. Create a checkout session
SESSION_RESPONSE=$(curl -s -X POST http://localhost:3000/v1/checkout/sessions \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "lineItems": [
      {
        "name": "Product 1",
        "quantity": 2,
        "unitAmount": 1000
      }
    ],
    "currency": "USD",
    "successUrl": "https://example.com/success",
    "cancelUrl": "https://example.com/cancel",
    "expiresInMinutes": 30
  }')

SESSION_ID=$(echo "$SESSION_RESPONSE" | jq -r '.id')
PUBLIC_ID=$(echo "$SESSION_RESPONSE" | jq -r '.publicId')

echo "Session ID: $SESSION_ID"
echo "Public ID: $PUBLIC_ID"
echo "Checkout URL: https://yourdomain.com/checkout/$PUBLIC_ID"

# 3. List all sessions
curl -s -X GET "http://localhost:3000/v1/checkout/sessions?limit=20&offset=0" \
  -H "Authorization: Bearer $ACCESS_TOKEN" | jq .

# 4. Get a single session
curl -s -X GET "http://localhost:3000/v1/checkout/sessions/$SESSION_ID" \
  -H "Authorization: Bearer $ACCESS_TOKEN" | jq .

# 5. Get public checkout page (no auth required)
curl -s -X GET "http://localhost:3000/v1/checkout/sessions/$PUBLIC_ID/public" | jq .

# 6. Expire the session
curl -s -X POST "http://localhost:3000/v1/checkout/sessions/$SESSION_ID/expire" \
  -H "Authorization: Bearer $ACCESS_TOKEN" | jq .

# 7. Verify the session is expired
curl -s -X GET "http://localhost:3000/v1/checkout/sessions/$SESSION_ID" \
  -H "Authorization: Bearer $ACCESS_TOKEN" | jq '.status'
# → "EXPIRED"
```

---

## Error Reference

| Status | Message | Cause |
|--------|---------|-------|
| 400 | `lineItems must be an array` | Invalid line items format |
| 400 | `currency must be a valid ISO 4217 currency code` | Invalid currency code |
| 400 | `Session is not open or already expired` | Trying to expire a non-OPEN session |
| 400 | `Shipping address requires line1, city, postalCode and country` | Missing required address fields |
| 400 | `Shipping country must be a valid ISO 3166-1 alpha-2 code` | Invalid country code |
| 400 | `Shipping to 'FR' is not allowed for this checkout session` | Country outside the merchant allowlist |
| 400 | `Unknown shipping option 'express'` | Shipping option id does not belong to the session |
| 401 | `Missing or invalid JWT` | Authentication required |
| 404 | `Session not found` | Session does not exist or belongs to another merchant |
| 410 | `Session has expired` | Public checkout page for expired session |

---

## Database Schema

### checkout_sessions table

```sql
id              UUID PRIMARY KEY
publicId        VARCHAR(32) NOT NULL UNIQUE
merchantId      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE
lineItems       JSONB NOT NULL DEFAULT '[]'
currency        VARCHAR(3) NOT NULL
subtotal        DECIMAL(10, 2) NULL
discountAmount  DECIMAL(10, 2) NOT NULL DEFAULT 0
shippingAddressCollection JSONB NULL
shippingOptions JSONB NOT NULL DEFAULT '[]'
shippingAddress JSONB NULL
shippingOptionId VARCHAR(64) NULL
shippingAmount  DECIMAL(10, 2) NOT NULL DEFAULT 0
total           DECIMAL(10, 2) NOT NULL
customerId      VARCHAR(200)
customerEmail   VARCHAR(320)
successUrl      TEXT NOT NULL
cancelUrl       TEXT NOT NULL
expiresAt       TIMESTAMP NOT NULL
status          ENUM('OPEN', 'COMPLETE', 'EXPIRED') NOT NULL DEFAULT 'OPEN'
paymentId       UUID REFERENCES payments(id) ON DELETE SET NULL
createdAt       TIMESTAMP NOT NULL
updatedAt       TIMESTAMP NOT NULL

INDEX idx_checkout_sessions_merchant_id (merchantId)
INDEX idx_checkout_sessions_public_id (publicId)
```

Migrations: `1751300000004-CreateCheckoutSessionsTable.ts`,
`1792500000001-AddCheckoutSessionCoupons.ts`, `1792800000000-AddCheckoutSessionShipping.ts`.
The shipping migration adds `customers."shippingAddress" jsonb NULL` as well; it is
fully reversible with `npm run migrate:revert`.

---

## Webhooks

Checkout session lifecycle events are delivered via webhooks. Subscribe to them when creating or updating a webhook endpoint (see [Webhooks](WEBHOOKS.md)).

| Event                       | Fired when                                                                 |
| --------------------------- | -------------------------------------------------------------------------- |
| `checkout.session.completed` | The payer completes payment and the session transitions `OPEN` → `COMPLETE` |
| `checkout.session.expired`  | An open session is expired manually or by the 10-minute cron job            |

Both events fire at most once per session. The payload includes the session ID, public ID, and (for completion) the resulting payment ID and customer email. When an address was collected, the `checkout.session.completed` payload also contains `shippingAddress`, `shippingAmount` and `shippingOptionId`, and the payment metadata contains `shippingAmount` and `shippingAddress` so the shipping line can be shown separately on receipts.

---

## See Also

- [Payments](../README.md#payments) — Payment creation after checkout
- [Merchant Branding](../README.md#merchant-branding) — Customizing the checkout page
- [Rates](RATES.md) — Currency handling
- [Environment](ENVIRONMENT.md) — Configuration reference

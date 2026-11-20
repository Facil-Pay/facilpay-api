# Customers

## Overview

The Customers resource allows merchants to store customer profiles for repeat business. Customers are owned by the merchant that creates them and can be attached to payments.

Customer email addresses are unique per merchant (case-insensitive). Multiple merchants can have customers with the same email, but a single merchant cannot.

---

## Customer Object

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "merchantId": "3d813cbb-47fb-4ba1-8eae-6e8cd7f4b126",
  "email": "jane.doe@example.com",
  "name": "Jane Doe",
  "phone": "+1-555-0100",
  "metadata": {
    "tier": "gold",
    "locale": "en-US"
  },
  "tags": ["vip", "wholesale"],
  "shippingAddress": {
    "name": "Jane Doe",
    "line1": "123 Main St",
    "city": "New York",
    "state": "NY",
    "postalCode": "10001",
    "country": "US"
  },
  "createdAt": "2026-09-25T10:00:00.000Z",
  "updatedAt": "2026-09-25T10:00:00.000Z",
  "deletedAt": null
}
```

| Field | Type | Description |
|-------|------|-------------|
| `id` | UUID | Customer identifier |
| `merchantId` | UUID | Owner merchant identifier |
| `email` | String | Customer email (unique per merchant, case-insensitive) |
| `name` | String | Customer display name (nullable) |
| `phone` | String | Customer phone number (nullable) |
| `metadata` | Object | Arbitrary JSON object (nullable) |
| `tags` | String[] | Segmentation tags, lowercase, unique, at most 20 (empty array when untagged) |
| `shippingAddress` | Object | Last shipping address collected through a checkout session (nullable) |
| `createdAt` | Timestamp | Creation timestamp |
| `updatedAt` | Timestamp | Last update timestamp |
| `deletedAt` | Timestamp | Soft-delete timestamp (null if active) |

---

## Create a Customer

```
POST /v1/customers
Authorization: Bearer <access_token>
```

**Request Body:**
```json
{
  "email": "jane.doe@example.com",
  "name": "Jane Doe",
  "phone": "+1-555-0100",
  "metadata": {
    "tier": "gold",
    "locale": "en-US"
  }
}
```

- `email` (required) — Customer email address. Max 320 characters.
- `name` (optional) — Customer display name. Max 255 characters.
- `phone` (optional) — Customer phone number. Max 50 characters.
- `metadata` (optional) — Arbitrary JSON object supplied by the merchant.
- `tags` (optional) — Up to 20 tags of at most 50 characters each. Tags are trimmed and lowercased, and duplicates and blanks are dropped, so `["VIP", " vip "]` is stored as `["vip"]`.

**Response (201 Created):**
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "merchantId": "3d813cbb-47fb-4ba1-8eae-6e8cd7f4b126",
  "email": "jane.doe@example.com",
  "name": "Jane Doe",
  "phone": "+1-555-0100",
  "metadata": {
    "tier": "gold",
    "locale": "en-US"
  },
  "createdAt": "2026-10-17T10:00:00.000Z",
  "updatedAt": "2026-10-17T10:00:00.000Z",
  "deletedAt": null
}
```

**Response (400 Bad Request):**
```json
{
  "statusCode": 400,
  "message": [
    "email must be an email"
  ],
  "error": "Bad Request"
}
```

**Response (409 Conflict):**
```json
{
  "statusCode": 409,
  "message": "The merchant already has a customer with this email",
  "error": "Conflict"
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

## List Customers

```
GET /v1/customers?page=1&limit=20&search=jane&tag=vip
Authorization: Bearer <access_token>
```

Returns a paginated list of active customers owned by the authenticated merchant.

**Query Parameters:**
- `page` (optional) — Page number (default: 1)
- `limit` (optional) — Items per page (default: 20, max: 100)
- `search` (optional) — Case-insensitive partial match against email or name
- `tag` (optional) — Only return customers carrying this tag. Matched case-insensitively and combined with `search` using AND. The filter uses a GIN index on `tags`.

**Response (200 OK):**
```json
{
  "data": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "merchantId": "3d813cbb-47fb-4ba1-8eae-6e8cd7f4b126",
      "email": "jane.doe@example.com",
      "name": "Jane Doe",
      "phone": "+1-555-0100",
      "metadata": { "tier": "gold" },
      "createdAt": "2026-09-25T10:00:00.000Z",
      "updatedAt": "2026-09-25T10:00:00.000Z",
      "deletedAt": null
    },
    {
      "id": "660e8400-e29b-41d4-a716-446655440001",
      "merchantId": "3d813cbb-47fb-4ba1-8eae-6e8cd7f4b126",
      "email": "jane.smith@example.com",
      "name": "Jane Smith",
      "phone": null,
      "metadata": null,
      "createdAt": "2026-09-26T11:00:00.000Z",
      "updatedAt": "2026-09-26T11:00:00.000Z",
      "deletedAt": null
    }
  ],
  "total": 2,
  "page": 1,
  "limit": 20
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

## Get a Customer

```
GET /v1/customers/:id
Authorization: Bearer <access_token>
```

**Response (200 OK):**
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "merchantId": "3d813cbb-47fb-4ba1-8eae-6e8cd7f4b126",
  "email": "jane.doe@example.com",
  "name": "Jane Doe",
  "phone": "+1-555-0100",
  "metadata": { "tier": "gold" },
  "createdAt": "2026-09-25T10:00:00.000Z",
  "updatedAt": "2026-09-25T10:00:00.000Z",
  "deletedAt": null
}
```

**Response (404 Not Found):**
```json
{
  "statusCode": 404,
  "message": "Customer not found or not owned by the authenticated merchant",
  "error": "Not Found"
}
```

Customers owned by other merchants or soft-deleted customers return 404.

**Response (401 Unauthorized):**
```json
{
  "statusCode": 401,
  "message": "Missing or invalid JWT",
  "error": "Unauthorized"
}
```

---

## Customer Portal

Create a short-lived, signed customer portal link for a customer owned by the
authenticated merchant:

```http
POST /v1/customers/:id/portal-sessions
Authorization: Bearer <access_token>
```

The response includes a URL and its expiration time. Links expire after one
hour by default. Set `CUSTOMER_PORTAL_SESSION_TTL_SECONDS` to an integer from 1
to 86400 to override the lifetime.

```json
{
  "url": "https://api.example.com/v1/public/customer-portal?token=<signed-token>",
  "expiresAt": "2026-10-21T13:00:00.000Z"
}
```

The public read-only endpoint accepts that signed token and returns the
customer's non-draft invoices, payments, and recurring plans:

```http
GET /v1/public/customer-portal?token=<signed-token>
```

The token is restricted to one customer and merchant. Deleted customers,
invalid tokens, and expired tokens are rejected. Responses omit merchant
metadata, callback URLs, invoice payment tokens, and other internal fields.

---

## Update a Customer

```
PATCH /v1/customers/:id
Authorization: Bearer <access_token>
```

**Request Body:**
```json
{
  "email": "jane.new@example.com",
  "name": "Jane Doe-Smith",
  "phone": "+1-555-0200",
  "metadata": {
    "tier": "platinum"
  }
}
```

All fields are optional. `tags` replaces the whole tag set (same normalisation as on create); send `[]` to remove every tag. To clear a nullable field, send `null`:

```json
{
  "phone": null,
  "metadata": null
}
```

**Response (200 OK):**
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "merchantId": "3d813cbb-47fb-4ba1-8eae-6e8cd7f4b126",
  "email": "jane.new@example.com",
  "name": "Jane Doe-Smith",
  "phone": "+1-555-0200",
  "metadata": {
    "tier": "platinum"
  },
  "createdAt": "2026-09-25T10:00:00.000Z",
  "updatedAt": "2026-10-17T10:15:00.000Z",
  "deletedAt": null
}
```

**Response (404 Not Found):**
```json
{
  "statusCode": 404,
  "message": "Customer not found or not owned by the authenticated merchant",
  "error": "Not Found"
}
```

**Response (409 Conflict):**
```json
{
  "statusCode": 409,
  "message": "The merchant already has a customer with this email",
  "error": "Conflict"
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

## Delete a Customer

```
DELETE /v1/customers/:id
Authorization: Bearer <access_token>
```

Soft-deletes the customer. Deleted customers:
- Are excluded from `GET /v1/customers` (list)
- Return 404 on `GET /v1/customers/:id` (get)
- Cannot be attached to new payments
- Retain historical payment associations (existing payments are unaffected)

**Response (204 No Content)**

No response body.

**Response (404 Not Found):**
```json
{
  "statusCode": 404,
  "message": "Customer not found or not owned by the authenticated merchant",
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

## Customer Payment History

```
GET /v1/customers/:id/payments?page=1&limit=20
Authorization: Bearer <access_token>
```

Returns a paginated list of payments associated with the customer.

**Query Parameters:**
- `page` (optional) — Page number (default: 1)
- `limit` (optional) — Items per page (default: 20, max: 100)

**Response (200 OK):**
```json
{
  "data": [
    {
      "id": "pay_550e8400-e29b-41d4-a716-446655440000",
      "customerId": "550e8400-e29b-41d4-a716-446655440000",
      "amount": 1000,
      "currency": "USD",
      "status": "COMPLETED",
      "createdAt": "2026-09-25T12:00:00.000Z"
    },
    {
      "id": "pay_660e8400-e29b-41d4-a716-446655440001",
      "customerId": "550e8400-e29b-41d4-a716-446655440000",
      "amount": 2000,
      "currency": "USD",
      "status": "COMPLETED",
      "createdAt": "2026-10-01T14:00:00.000Z"
    }
  ],
  "total": 2,
  "page": 1,
  "limit": 20
}
```

**Response (404 Not Found):**
```json
{
  "statusCode": 404,
  "message": "Customer not found or not owned by the authenticated merchant",
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

## Merchant Ownership

Customers are **merchant-scoped**:
- A merchant can only read, update, or delete their own customers.
- Attempting to access another merchant's customer returns 404.
- Soft-deleted customers return 404 as if they don't exist.

Email uniqueness is also merchant-scoped:
- `merchant-a@example.com` and `merchant-b@example.com` can each have a customer with email `customer@example.com`.
- `merchant-a@example.com` cannot create two customers with the same email (case-insensitive).

---

## What Happens When a Customer is Deleted?

When `DELETE /v1/customers/:id` is called:
1. The customer's `deletedAt` is set to the current timestamp (soft delete).
2. The customer is excluded from all read endpoints (`GET /v1/customers`, `GET /v1/customers/:id`).
3. Existing payments associated with the customer are **not** affected — they retain their `customerId` reference.
4. New payments **cannot** be created with the deleted customer's ID (validation will fail).

To restore a deleted customer, update the `deletedAt` column to `NULL` in the database (no API endpoint is provided for this).

---

## Complete curl Walkthrough

```bash
# 1. Log in to get an access token
ACCESS_TOKEN=$(curl -s -X POST http://localhost:3000/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"merchant@example.com","password":"P@ssw0rd!"}' \
  | jq -r '.access_token')

# 2. Create a customer
CUSTOMER_ID=$(curl -s -X POST http://localhost:3000/v1/customers \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "jane.doe@example.com",
    "name": "Jane Doe",
    "phone": "+1-555-0100",
    "metadata": { "tier": "gold" }
  }' | jq -r '.id')

echo "Customer ID: $CUSTOMER_ID"

# 3. List customers
curl -s -X GET "http://localhost:3000/v1/customers?page=1&limit=20" \
  -H "Authorization: Bearer $ACCESS_TOKEN" | jq .

# 4. Get a single customer
curl -s -X GET "http://localhost:3000/v1/customers/$CUSTOMER_ID" \
  -H "Authorization: Bearer $ACCESS_TOKEN" | jq .

# 5. Update a customer
curl -s -X PATCH "http://localhost:3000/v1/customers/$CUSTOMER_ID" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Jane Doe-Smith",
    "metadata": { "tier": "platinum" }
  }' | jq .

# 6. Get customer payment history
curl -s -X GET "http://localhost:3000/v1/customers/$CUSTOMER_ID/payments?page=1&limit=20" \
  -H "Authorization: Bearer $ACCESS_TOKEN" | jq .

# 7. Delete a customer
curl -i -X DELETE "http://localhost:3000/v1/customers/$CUSTOMER_ID" \
  -H "Authorization: Bearer $ACCESS_TOKEN"
# → 204 No Content

# 8. Verify customer is deleted
curl -s -X GET "http://localhost:3000/v1/customers/$CUSTOMER_ID" \
  -H "Authorization: Bearer $ACCESS_TOKEN" | jq .
# → 404 Not Found
```

---

## Error Reference

| Status | Message | Cause |
|--------|---------|-------|
| 400 | `email must be an email` | Invalid email format |
| 401 | `Missing or invalid JWT` | Authentication required |
| 404 | `Customer not found or not owned by the authenticated merchant` | Customer does not exist, is soft-deleted, or belongs to another merchant |
| 409 | `The merchant already has a customer with this email` | Email uniqueness violation (case-insensitive) |

---

## Database Schema

### customers table

```sql
id           UUID PRIMARY KEY
merchantId   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE
email        VARCHAR(320) NOT NULL
name         VARCHAR(255)
phone        VARCHAR(50)
metadata     JSONB
tags         TEXT[] NOT NULL DEFAULT '{}'
shippingAddress JSONB
createdAt    TIMESTAMP NOT NULL
updatedAt    TIMESTAMP NOT NULL
deletedAt    TIMESTAMP  -- Soft delete timestamp

UNIQUE (merchantId, email) WHERE deletedAt IS NULL
INDEX idx_customers_merchant_id (merchantId)
INDEX idx_customers_email (email)
INDEX IDX_customers_tags USING GIN (tags)
```

Migration: TBD. The `tags` column and its GIN index are added by `AddTagsToCustomers1792500000000`; the `shippingAddress` column is added by `AddCheckoutSessionShipping1792800000000`. When a checkout session with a collected address completes, the address is copied here (a customer is created when none exists for the payer email).

---

## See Also

- [Payments](../README.md#payments) — Attaching customers to payments
- [RBAC](RBAC.md) — Merchant access control

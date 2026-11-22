# API Conventions

FacilPay follows consistent conventions across all endpoints for pagination, filtering, sorting, expansion, and HTTP headers.

## Pagination

### Offset-Based Pagination

Most list endpoints use offset-based pagination with `page` and `limit` query parameters:

```bash
curl https://api.facilpay.com/v1/invoices?page=2&limit=50 \
  -H "Authorization: Bearer sk_test_xxx"
```

**Query Parameters:**
- `page` — Page number, starts at 1 (default: `1`)
- `limit` — Items per page, max 100 (default: `20`)

**Response Shape:**
```json
{
  "data": [ ... ],
  "total": 234,
  "page": 2,
  "limit": 50
}
```

- `data` — Array of items for the current page
- `total` — Total count of items across all pages
- `page` — Current page number
- `limit` — Items per page

Offset pagination is simple but can miss or duplicate items if data changes between pages (e.g., new records inserted).

### Cursor-Based Pagination

For large datasets or when stable pagination is required, use cursor-based pagination with the `cursor` query parameter:

```bash
curl https://api.facilpay.com/v1/payments?cursor=eyJpZCI6IjEyMyJ9&limit=50 \
  -H "Authorization: Bearer sk_test_xxx"
```

**Query Parameters:**
- `cursor` — Opaque cursor string (base64-encoded) from the previous page
- `limit` — Items per page, max 100 (default: `20`)

**Response Shape:**
```json
{
  "data": [ ... ],
  "nextCursor": "eyJpZCI6IjE3MyJ9",
  "hasMore": true
}
```

- `data` — Array of items for the current page
- `nextCursor` — Cursor for the next page (null if no more pages)
- `hasMore` — Whether more pages exist

To fetch the next page, pass `nextCursor` as the `cursor` parameter. When `cursor` is provided, `page` is ignored.

**Which to use?**
- Use offset pagination for browsable lists (e.g., admin dashboards)
- Use cursor pagination for large exports, webhooks, or streaming data

## Sorting

Specify sort order with `sortBy` and `order`:

```bash
curl "https://api.facilpay.com/v1/invoices?sortBy=createdAt&order=ASC" \
  -H "Authorization: Bearer sk_test_xxx"
```

**Query Parameters:**
- `sortBy` — Field name to sort by (e.g., `createdAt`, `amount`, `status`)
- `order` — Sort direction: `ASC` (ascending) or `DESC` (descending, default)

Not all endpoints support all fields for sorting. Check the endpoint documentation for supported fields.

## Filtering

Many endpoints support filtering by specific fields via query parameters:

```bash
curl "https://api.facilpay.com/v1/payments?status=completed&currency=USD" \
  -H "Authorization: Bearer sk_test_xxx"
```

Common filters:
- `status` — Filter by status (e.g., `pending`, `completed`, `failed`)
- `currency` — Filter by currency code (e.g., `USD`, `EUR`)
- `search` — Search by email, name, or other text fields (partial match)
- Date ranges: `createdAfter`, `createdBefore`, `startDate`, `endDate`

Filters are endpoint-specific. Refer to the OpenAPI docs or endpoint documentation for available filters.

## Expansion

Some endpoints support expanding related resources with the `expand` query parameter:

```bash
curl "https://api.facilpay.com/v1/invoices/inv_123?expand=lineItems,payment" \
  -H "Authorization: Bearer sk_test_xxx"
```

**Query Parameter:**
- `expand` — Comma-separated list of relations to include (e.g., `lineItems`, `customer`, `payment`)

Without `expand`, related resources are returned as IDs only. With `expand`, they are embedded in the response:

```json
{
  "id": "inv_123",
  "customerId": "cus_456",
  "lineItems": [
    { "id": "li_1", "description": "Consulting", "amount": "100.00" }
  ],
  "payment": {
    "id": "pay_789",
    "status": "completed"
  }
}
```

Not all endpoints or relations support expansion. Check the endpoint documentation.

## HTTP Headers

### Authentication

All authenticated endpoints require the `Authorization` header:

```bash
Authorization: Bearer sk_test_xxx
```

Use your secret API key (`sk_test_xxx` for test mode, `sk_live_xxx` for production).

### Idempotency

To safely retry requests, include an `Idempotency-Key` header:

```bash
curl -X POST https://api.facilpay.com/v1/payments \
  -H "Authorization: Bearer sk_test_xxx" \
  -H "Idempotency-Key: unique-request-id-123" \
  -H "Content-Type: application/json" \
  -d '{"amount": "100.00", "currency": "USD"}'
```

If the same key is sent multiple times within 24 hours, the API returns the cached response from the first successful request. See [IDEMPOTENCY.md](./IDEMPOTENCY.md) for details.

### ETags and Conditional Requests

Some endpoints return an `ETag` header for caching:

```http
HTTP/1.1 200 OK
ETag: "33a64df551425fcc55e4d42a148795d9f25f89d4"
```

Send the `If-None-Match` header on subsequent requests to skip unchanged responses:

```bash
curl https://api.facilpay.com/v1/invoices/inv_123 \
  -H "Authorization: Bearer sk_test_xxx" \
  -H "If-None-Match: \"33a64df551425fcc55e4d42a148795d9f25f89d4\""
```

If the resource hasn't changed, the API returns `304 Not Modified` with no body.

### Content Type

Always send `Content-Type: application/json` for POST, PUT, and PATCH requests:

```bash
curl -X POST https://api.facilpay.com/v1/invoices \
  -H "Authorization: Bearer sk_test_xxx" \
  -H "Content-Type: application/json" \
  -d '{"customerEmail": "buyer@example.com", "currency": "USD", ...}'
```

### CORS

FacilPay supports CORS for browser-based requests. Configure allowed origins via the `ALLOWED_ORIGINS` environment variable. See [ENVIRONMENT.md](./ENVIRONMENT.md).

## Error Responses

All errors return a consistent JSON shape:

```json
{
  "statusCode": 400,
  "message": "Validation failed",
  "error": "Bad Request",
  "details": [
    { "field": "customerEmail", "message": "Invalid email format" }
  ]
}
```

- `statusCode` — HTTP status code (4xx for client errors, 5xx for server errors)
- `message` — Human-readable error description
- `error` — Error type (e.g., `Bad Request`, `Unauthorized`, `Not Found`)
- `details` — Optional array of field-level validation errors

Common status codes:
- `400` — Bad Request (invalid input)
- `401` — Unauthorized (missing or invalid API key)
- `403` — Forbidden (insufficient permissions)
- `404` — Not Found
- `409` — Conflict (e.g., duplicate idempotency key with different request)
- `422` — Unprocessable Entity (semantic validation failure)
- `429` — Too Many Requests (rate limit exceeded)
- `500` — Internal Server Error
- `503` — Service Unavailable

## Rate Limiting

FacilPay enforces rate limits to prevent abuse. Rate limit headers are included in every response:

```http
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1609459200
```

- `X-RateLimit-Limit` — Max requests per window
- `X-RateLimit-Remaining` — Requests remaining in current window
- `X-RateLimit-Reset` — Unix timestamp when the window resets

When the limit is exceeded, the API returns `429 Too Many Requests`:

```json
{
  "statusCode": 429,
  "message": "Rate limit exceeded",
  "error": "Too Many Requests"
}
```

See [MERCHANT_RATE_LIMITING.md](./MERCHANT_RATE_LIMITING.md) for per-merchant limits.

## Versioning

All endpoints are prefixed with `/v1/`:

```
https://api.facilpay.com/v1/payments
```

Future API versions will use `/v2/`, etc. Breaking changes will only be introduced in new versions.

## Example: Complete Request

```bash
curl -X GET "https://api.facilpay.com/v1/invoices?page=1&limit=20&sortBy=createdAt&order=DESC&status=open&expand=lineItems" \
  -H "Authorization: Bearer sk_test_xxx" \
  -H "If-None-Match: \"abc123\""
```

Response:

```json
{
  "data": [
    {
      "id": "inv_123",
      "number": 1001,
      "customerEmail": "buyer@example.com",
      "status": "open",
      "total": "500.00",
      "currency": "USD",
      "createdAt": "2026-11-22T10:00:00Z",
      "lineItems": [
        { "description": "Consulting", "quantity": 5, "unitPrice": "100.00" }
      ]
    }
  ],
  "total": 42,
  "page": 1,
  "limit": 20
}
```

## Summary

- **Pagination**: Use `page`/`limit` (offset) or `cursor` (stable)
- **Sorting**: Use `sortBy` and `order`
- **Filtering**: Query parameters like `status`, `currency`, `search`
- **Expansion**: Use `expand` to embed related resources
- **Headers**: `Authorization`, `Idempotency-Key`, `If-None-Match`, `Content-Type`
- **Errors**: Consistent JSON shape with `statusCode`, `message`, `error`
- **Rate Limits**: Check `X-RateLimit-*` headers

For endpoint-specific details, refer to the OpenAPI documentation at `/v1/docs` or the feature guides in this directory.

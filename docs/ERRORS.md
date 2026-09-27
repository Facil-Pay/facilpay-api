# Error Responses

This document describes the JSON envelope returned by the API on error, the
meaning of the common status codes, and how to build robust error handling.

## Error envelope

Validation errors (thrown as `BadRequestException` or
`UnprocessableEntityException`) are shaped by
`src/common/filters/validation-exception.filter.ts`:

```json
{
  "statusCode": 400,
  "timestamp": "2026-09-27T12:00:00.000Z",
  "path": "/v1/payments",
  "message": "Validation failed",
  "error": "BadRequestException",
  "validationErrors": [
    {
      "field": "amount",
      "errors": ["amount must be a positive number"]
    }
  ]
}
```

| Field | Description |
| --- | --- |
| `statusCode` | HTTP status code |
| `timestamp` | ISO 8601 timestamp of the error |
| `path` | Request path that produced the error |
| `message` | Human-readable message (string or array of strings) |
| `error` | Exception class name (e.g. `BadRequestException`) |
| `validationErrors` | *(optional)* Array of `{ field, errors[] }` for field-level validation failures |

Database errors (TypeORM `QueryFailedError`) are shaped by
`src/modules/logger/logging-exception.filter.ts`:

```json
{
  "statusCode": 400,
  "message": "A resource with this value already exists",
  "error": "QueryFailedError",
  "timestamp": "2026-09-27T12:00:00.000Z",
  "path": "/v1/payments"
}
```

The message is derived from the database error: `"A resource with this value
already exists"` for duplicates, `"Invalid data provided"` for constraint
violations, and `"Database error occurred"` otherwise.

## Correlation / request ID

Each request is assigned an internal `requestId` used in structured logs. When
contacting support, include the `requestId` (or the `path` + `timestamp` from
the error body) so the failing request can be located in the logs.

## Common status codes

| Status | When it is returned |
| --- | --- |
| `400 Bad Request` | Validation failure, malformed input, or a database query error |
| `401 Unauthorized` | Missing or invalid JWT, or a reused/revoked refresh token |
| `403 Forbidden` | Access denied — includes IP allowlist blocks and geo-restrictions (see below) |
| `404 Not Found` | Resource (session, plan, payment, etc.) does not exist |
| `409 Conflict` | Idempotency conflict or an invalid state transition (e.g. pausing an already-paused plan) |
| `422 Unprocessable Entity` | Semantic validation failure |
| `429 Too Many Requests` | Rate limit exceeded; includes a `Retry-After` header |
| `503 Service Unavailable` | Service temporarily unavailable |

## Custom exception classes

The following custom exceptions are thrown by the API. Both extend NestJS's
`ForbiddenException`, so they return `403` and include a machine-readable
`code` field:

| Exception | HTTP | `code` | Meaning |
| --- | --- | --- | --- |
| `GeoRestrictedException` | `403` | `geo_restricted` | Payment originates from a region the merchant does not permit |
| `IpAllowlistBlockedException` | `403` | `ip_not_allowed` | The source IP is not in the merchant's allowlist |

Example:

```json
{
  "statusCode": 403,
  "message": "Access denied: IP address 203.0.113.7 is not in the merchant's allowlist",
  "error": "Forbidden",
  "code": "ip_not_allowed"
}
```

## Validation error example

A request that fails multiple field validations returns one `validationErrors`
entry per field, with all messages for that field grouped together:

```json
{
  "statusCode": 400,
  "timestamp": "2026-09-27T12:00:00.000Z",
  "path": "/v1/recurring-payments",
  "message": [
    "amount must be a positive number",
    "currency must be a valid ISO 4217 code"
  ],
  "error": "BadRequestException",
  "validationErrors": [
    {
      "field": "amount",
      "errors": ["amount must be a positive number"]
    },
    {
      "field": "currency",
      "errors": ["currency must be a valid ISO 4217 code"]
    }
  ]
}
```

## Handling guidance

- Inspect `statusCode` first, then `code` (when present) for the precise
  failure reason.
- Treat `validationErrors[].field` as the canonical field name for per-field
  feedback to the user.
- Respect the `Retry-After` header on `429` responses and back off.

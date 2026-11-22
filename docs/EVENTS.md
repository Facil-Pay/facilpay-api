# Events

## Overview

The Events API gives merchants a queryable, auditable log of every significant action that occurred on their account. Events are the same records that power [webhook deliveries](WEBHOOKS.md) — reading them directly is useful for auditing, debugging missed deliveries, and replaying business logic without relying on a live webhook endpoint.

All Events API endpoints live under `/v1/events` and require a valid JWT.

---

## Event Object

Every event stored in the system shares the same envelope shape regardless of the underlying action type.

```json
{
  "id": "a1b2c3d4-e89b-12d3-a456-426614174000",
  "merchantId": "abc123",
  "type": "payment.completed",
  "payload": {
    "paymentId": "123e4567-e89b-12d3-a456-426614174000",
    "amount": "250.00",
    "currency": "USD",
    "status": "COMPLETED"
  },
  "createdAt": "2026-01-26T10:05:00.000Z"
}
```

### Fields

| Field        | Type            | Description                                                                        |
| ------------ | --------------- | ---------------------------------------------------------------------------------- |
| `id`         | `string (uuid)` | Unique identifier for the event                                                    |
| `merchantId` | `string (uuid)` | The merchant this event belongs to. `null` for system-level events                 |
| `type`       | `string`        | The event type (e.g. `payment.completed`). Maximum 128 characters                  |
| `payload`    | `object`        | Event-specific data (entity snapshot at the moment the event was emitted)          |
| `createdAt`  | `string`        | ISO-8601 UTC timestamp of when the event was recorded                              |

> The `payload` field mirrors the same `data` object delivered inside a [webhook payload envelope](WEBHOOKS.md#payload-envelope). Consumers can use it directly without a follow-up API call.

---

## Supported Event Types

| Type                              | Description                                                                     |
| --------------------------------- | ------------------------------------------------------------------------------- |
| `payment.created`                 | A new payment is initiated                                                      |
| `payment.updated`                 | Mutable payment details are updated                                             |
| `payment.completed`               | A payment settles successfully                                                  |
| `payment.failed`                  | A payment attempt fails                                                         |
| `payment.expired`                 | A payment expires without completion                                            |
| `payment.split_processed`         | A split payment is processed                                                    |
| `refund.issued`                   | A full or partial refund is committed                                           |
| `refund.failed`                   | A refund's Stellar submission fails                                              |
| `dispute.opened`                  | A dispute is opened on a payment                                                |
| `dispute.updated`                 | A dispute changes status                                                        |
| `dispute.resolved`                | A dispute is resolved                                                           |
| `dispute.closed`                  | A dispute is closed                                                             |
| `transaction.multisig_required`   | A multi-sig transaction is pending additional signatures                        |
| `transaction.multisig_completed`  | A multi-sig transaction has gathered all required signatures and been submitted |
| `settlement.created`              | A settlement is created                                                         |
| `settlement.completed`            | A settlement payout completes successfully                                      |
| `settlement.failed`               | A settlement payout fails                                                       |

---

## Endpoints

### List Events

```
GET /v1/events
```

Returns a paginated list of events for the authenticated merchant, ordered newest first. Supports cursor-based pagination and optional filters.

**Query Parameters**

| Parameter | Type     | Required | Description                                               |
| --------- | -------- | -------- | --------------------------------------------------------- |
| `type`    | `string` | No       | Filter by event type (e.g. `payment.completed`)           |
| `from`    | `string` | No       | Return events at or after this ISO-8601 datetime          |
| `to`      | `string` | No       | Return events at or before this ISO-8601 datetime         |
| `cursor`  | `string` | No       | Opaque pagination cursor from a previous response         |
| `limit`   | `number` | No       | Number of events to return per page (default: `20`)       |

**Response — `200 OK`**

```json
{
  "data": [
    {
      "id": "a1b2c3d4-e89b-12d3-a456-426614174000",
      "merchantId": "abc123",
      "type": "payment.completed",
      "payload": {
        "paymentId": "123e4567-e89b-12d3-a456-426614174000",
        "amount": "250.00",
        "currency": "USD",
        "status": "COMPLETED"
      },
      "createdAt": "2026-01-26T10:05:00.000Z"
    }
  ],
  "nextCursor": "eyJjcmVhdGVkQXQiOiIyMDI2LTAxLTI2VDEwOjA1OjAwLjAwMFoiLCJpZCI6ImExYjJjM2Q0In0=",
  "hasMore": true
}
```

**Response Fields**

| Field        | Type            | Description                                                           |
| ------------ | --------------- | --------------------------------------------------------------------- |
| `data`       | `Event[]`       | Array of event objects for this page                                  |
| `nextCursor` | `string\|null`  | Opaque cursor to pass as `cursor` to fetch the next page. `null` when there are no more results |
| `hasMore`    | `boolean`       | `true` if additional pages exist                                      |

**Error Responses**

| Status | Condition              |
| ------ | ---------------------- |
| `401`  | Missing or invalid JWT |

---

### Get a Single Event

```
GET /v1/events/:id
```

Returns a single event by its UUID. The event must belong to the authenticated merchant.

**Path Parameters**

| Parameter | Type            | Description        |
| --------- | --------------- | ------------------ |
| `id`      | `string (uuid)` | The event's UUID   |

**Response — `200 OK`**

```json
{
  "id": "a1b2c3d4-e89b-12d3-a456-426614174000",
  "merchantId": "abc123",
  "type": "payment.completed",
  "payload": {
    "paymentId": "123e4567-e89b-12d3-a456-426614174000",
    "amount": "250.00",
    "currency": "USD",
    "status": "COMPLETED"
  },
  "createdAt": "2026-01-26T10:05:00.000Z"
}
```

**Error Responses**

| Status | Condition                                          |
| ------ | -------------------------------------------------- |
| `401`  | Missing or invalid JWT                             |
| `404`  | Event not found or belongs to another merchant     |

---

## Pagination

The Events API uses **cursor-based pagination**. Each page response includes a `nextCursor` value (a base64-encoded composite of `createdAt` and `id`) that encodes the position of the last item on the current page.

To paginate through all events:

1. Make an initial request (no `cursor`).
2. If `hasMore` is `true`, pass the returned `nextCursor` as the `cursor` query parameter on the next request.
3. Repeat until `hasMore` is `false` or `nextCursor` is `null`.

**Example — fetching the first page:**

```bash
curl "https://api.facilpay.com/v1/events?limit=20&type=payment.completed" \
  -H "Authorization: Bearer <jwt>"
```

**Example — fetching subsequent pages:**

```bash
curl "https://api.facilpay.com/v1/events?limit=20&type=payment.completed&cursor=<nextCursor>" \
  -H "Authorization: Bearer <jwt>"
```

> Cursors are stable within a consistent sort order (newest first). Adding or changing filters invalidates any previously obtained cursor — always start a fresh query when filter parameters change.

---

## Retention

Events are retained for **30 days** by default. This window is controlled by the `EVENT_RETENTION_DAYS` environment variable (see [Environment](ENVIRONMENT.md)).

Events older than the retention window are automatically purged by a scheduled cleanup job. Query historical events within the window using the `from` / `to` filters.

---

## Relationship to Webhooks

Events and webhook deliveries share the same underlying data:

- When an event is emitted, the platform records it in the `events` table and enqueues a delivery for each matching webhook endpoint.
- The `payload` field of an event is identical to the `data` field inside a [webhook payload envelope](WEBHOOKS.md#payload-envelope).
- If a webhook delivery fails or is dead-lettered, the original event remains accessible via this API for auditing or manual replay.

For full details on webhook subscriptions, delivery retries, and signature verification, see [WEBHOOKS.md](WEBHOOKS.md).

---

## Authentication & Permissions

All Events API endpoints require a valid JWT in the `Authorization` header:

```http
Authorization: Bearer <your_jwt_token>
```

Ownership is enforced at the service layer — merchants can only access their own events.

| Role      | Can read events? |
| --------- | ---------------- |
| **ADMIN** | Yes              |
| **USER**  | Yes              |

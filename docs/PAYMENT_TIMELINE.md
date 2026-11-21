# Payment Timeline

## Overview

The payment timeline endpoint provides a chronological record of all significant events in a payment's lifecycle. This includes status changes, refunds, disputes, expirations, and cancellations. Timeline events are immutable and timestamped for audit and reporting purposes.

---

## Timeline Event Object

```json
{
  "id": "event_abc123def456",
  "paymentId": "payment-uuid",
  "type": "payment.status_updated",
  "timestamp": "2026-01-15T14:30:00.000Z",
  "data": {
    "previousStatus": "PENDING",
    "currentStatus": "COMPLETED",
    "amount": 5000,
    "reason": "Payment confirmed by Stellar network"
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `id` | String | Unique event identifier |
| `paymentId` | UUID | Associated payment identifier |
| `type` | String | Event type (see Event Types section) |
| `timestamp` | Date | When the event occurred (ISO 8601) |
| `data` | Object | Event-specific details (varies by type) |

---

## Event Types

### payment.created

Emitted when a payment is first created.

```json
{
  "id": "event_123",
  "paymentId": "payment-uuid",
  "type": "payment.created",
  "timestamp": "2026-01-15T10:00:00.000Z",
  "data": {
    "amount": 5000,
    "currency": "USD",
    "customerId": "cus_123",
    "paymentMethod": "card",
    "description": "Invoice #12345"
  }
}
```

---

### payment.status_updated

Emitted when a payment's status transitions.

```json
{
  "id": "event_124",
  "paymentId": "payment-uuid",
  "type": "payment.status_updated",
  "timestamp": "2026-01-15T14:30:00.000Z",
  "data": {
    "previousStatus": "PENDING",
    "currentStatus": "COMPLETED",
    "reason": "Payment confirmed by Stellar network"
  }
}
```

**Common Status Transitions**:
- `PENDING` → `COMPLETED`
- `PENDING` → `FAILED`
- `COMPLETED` → `REFUNDED` (via refund)
- `PENDING` → `CANCELLED`

---

### payment.cancelled

Emitted when a payment is explicitly cancelled.

```json
{
  "id": "event_125",
  "paymentId": "payment-uuid",
  "type": "payment.cancelled",
  "timestamp": "2026-01-15T15:00:00.000Z",
  "data": {
    "reason": "Customer requested cancellation",
    "cancelledBy": "merchant",
    "amount": 5000,
    "currency": "USD"
  }
}
```

---

### payment.expired

Emitted when a payment expires (typically invoice/link expiration).

```json
{
  "id": "event_126",
  "paymentId": "payment-uuid",
  "type": "payment.expired",
  "timestamp": "2026-01-16T10:00:00.000Z",
  "data": {
    "reason": "Payment link expired after 30 days",
    "expiresAt": "2026-01-16T10:00:00.000Z",
    "amount": 5000,
    "currency": "USD"
  }
}
```

---

### refund.created

Emitted when a refund is issued for a payment.

```json
{
  "id": "event_127",
  "paymentId": "payment-uuid",
  "type": "refund.created",
  "timestamp": "2026-01-15T15:30:00.000Z",
  "data": {
    "refundId": "refund_uuid",
    "amount": 5000,
    "reason": "Customer requested refund",
    "status": "PENDING",
    "refundedAt": "2026-01-15T15:30:00.000Z"
  }
}
```

---

### dispute.opened

Emitted when a dispute is opened for a payment.

```json
{
  "id": "event_128",
  "paymentId": "payment-uuid",
  "type": "dispute.opened",
  "timestamp": "2026-01-18T09:00:00.000Z",
  "data": {
    "disputeId": "dispute_uuid",
    "reason": "customer_initiated_chargeback",
    "amount": 5000,
    "dueBy": "2026-02-01T09:00:00.000Z",
    "evidence_deadline_days": 14
  }
}
```

---

### dispute.resolved

Emitted when a dispute is resolved in the merchant's favor.

```json
{
  "id": "event_129",
  "paymentId": "payment-uuid",
  "type": "dispute.resolved",
  "timestamp": "2026-02-05T16:00:00.000Z",
  "data": {
    "disputeId": "dispute_uuid",
    "outcome": "won",
    "reason": "Evidence provided by merchant accepted",
    "amount": 5000,
    "resolvedAt": "2026-02-05T16:00:00.000Z"
  }
}
```

---

### dispute.closed

Emitted when a dispute is closed (lost or cancelled).

```json
{
  "id": "event_130",
  "paymentId": "payment-uuid",
  "type": "dispute.closed",
  "timestamp": "2026-02-10T12:00:00.000Z",
  "data": {
    "disputeId": "dispute_uuid",
    "outcome": "lost",
    "reason": "Insufficient evidence provided",
    "amount": 5000,
    "amountRefunded": 5000,
    "closedAt": "2026-02-10T12:00:00.000Z"
  }
}
```

---

## API Endpoint

### GET /v1/payments/:id/timeline

Retrieve the complete timeline for a payment.

**Authentication**: JWT Bearer token required

**Path Parameters**:
- `id` (UUID, required): Payment identifier

**Query Parameters**:
- `limit` (integer, optional): Maximum number of events to return (default: 50, max: 100)
- `offset` (integer, optional): Number of events to skip for pagination (default: 0)
- `type` (string, optional): Filter by event type (e.g., `dispute.opened`, `refund.created`)
- `from` (ISO 8601 date, optional): Return events after this timestamp
- `to` (ISO 8601 date, optional): Return events before this timestamp

**Request**:
```http
GET /v1/payments/payment-123/timeline?limit=20&type=refund.created HTTP/1.1
Host: api.facilpay.com
Authorization: Bearer <jwt_token>
```

**Response** (200 OK):
```json
{
  "paymentId": "payment-uuid",
  "total": 5,
  "limit": 20,
  "offset": 0,
  "events": [
    {
      "id": "event_123",
      "paymentId": "payment-uuid",
      "type": "payment.created",
      "timestamp": "2026-01-15T10:00:00.000Z",
      "data": {
        "amount": 5000,
        "currency": "USD",
        "customerId": "cus_123",
        "paymentMethod": "card",
        "description": "Invoice #12345"
      }
    },
    {
      "id": "event_124",
      "paymentId": "payment-uuid",
      "type": "payment.status_updated",
      "timestamp": "2026-01-15T14:30:00.000Z",
      "data": {
        "previousStatus": "PENDING",
        "currentStatus": "COMPLETED",
        "reason": "Payment confirmed by Stellar network"
      }
    }
  ]
}
```

**Error Responses**:
- `400 Bad Request`: Invalid query parameters (e.g., invalid date format)
- `404 Not Found`: Payment does not exist or is not owned by the merchant
- `401 Unauthorized`: Missing or invalid authentication token

---

## Timeline Ordering

Events are returned in **chronological order** (oldest first) by default. The response includes:
- **total**: Total number of events for this payment
- **limit**: Maximum events returned in this request
- **offset**: Number of events skipped (for pagination)
- **events**: Array of timeline events

---

## Examples

### Example 1: Complete Payment Timeline

```bash
curl https://api.facilpay.com/v1/payments/pay_123/timeline \
  -H "Authorization: Bearer <jwt_token>"
```

Response shows the full lifecycle:
1. `payment.created` (2026-01-15 10:00)
2. `payment.status_updated` PENDING → COMPLETED (2026-01-15 14:30)

### Example 2: Disputed Payment Timeline

```bash
curl 'https://api.facilpay.com/v1/payments/pay_456/timeline' \
  -H "Authorization: Bearer <jwt_token>"
```

Response shows:
1. `payment.created` (2026-01-15 10:00)
2. `payment.status_updated` PENDING → COMPLETED (2026-01-15 14:30)
3. `dispute.opened` (2026-01-18 09:00)
4. `dispute.resolved` outcome: "won" (2026-02-05 16:00)

### Example 3: Refunded Payment Timeline

```bash
curl 'https://api.facilpay.com/v1/payments/pay_789/timeline?type=refund.created' \
  -H "Authorization: Bearer <jwt_token>"
```

Response filtered to show only refund events:
1. `refund.created` reason: "Customer requested refund" (2026-01-20 11:45)

### Example 4: Pagination

```bash
curl 'https://api.facilpay.com/v1/payments/pay_999/timeline?limit=10&offset=10' \
  -H "Authorization: Bearer <jwt_token>"
```

Response returns events 11-20 (for large timelines).

---

## Use Cases

### Audit Trail
Retrieve the complete timeline for compliance and audit purposes—all events are immutable and timestamped.

### Dispute Investigation
View all dispute-related events for a payment to understand the timeline and resolution.

### Refund History
Query refund events to track all refunds issued for a payment.

### Status Tracking
Monitor payment status transitions to understand payment progress and any anomalies.

---

## Rate Limiting

Timeline endpoints follow standard rate limits:
- GET /payments/:id/timeline: 30 requests per minute per merchant

---

## Data Retention

Timeline events are retained indefinitely. They cannot be modified or deleted and serve as the authoritative record of payment events.

# Payment Refunds

## Overview

The refund system allows operators to issue full or partial refunds against completed payments. Refunds are tracked separately and update the payment status accordingly.

## Endpoint

```
POST /payments/:id/refund
```

## Request Body

```json
{
  "amount": 50.00,  // Optional: defaults to full refund
  "reason": "Customer requested refund"  // Optional
}
```

## Payment Statuses

- **PENDING**: Initial state, cannot be refunded
- **COMPLETED**: Can be refunded
- **PARTIALLY_REFUNDED**: Some amount has been refunded, more can be refunded
- **REFUNDED**: Fully refunded, no more refunds allowed
- **FAILED**: Cannot be refunded

## Examples

### Full Refund

```bash
curl -X POST http://localhost:3000/payments/123e4567-e89b-12d3-a456-426614174000/refund \
  -H "Content-Type: application/json" \
  -d '{}'
```

Response:
```json
{
  "payment": {
    "id": "123e4567-e89b-12d3-a456-426614174000",
    "amount": "100.00",
    "currency": "USD",
    "status": "REFUNDED",
    "refundedAmount": "100.00",
    "createdAt": "2026-01-26T10:00:00.000Z",
    "updatedAt": "2026-01-26T11:00:00.000Z"
  },
  "refund": {
    "id": "456e7890-e89b-12d3-a456-426614174000",
    "paymentId": "123e4567-e89b-12d3-a456-426614174000",
    "amount": "100.00",
    "reason": null,
    "createdAt": "2026-01-26T11:00:00.000Z"
  }
}
```

### Partial Refund

```bash
curl -X POST http://localhost:3000/payments/123e4567-e89b-12d3-a456-426614174000/refund \
  -H "Content-Type: application/json" \
  -d '{"amount": 50, "reason": "Partial refund for damaged item"}'
```

Response:
```json
{
  "payment": {
    "id": "123e4567-e89b-12d3-a456-426614174000",
    "amount": "100.00",
    "currency": "USD",
    "status": "PARTIALLY_REFUNDED",
    "refundedAmount": "50.00",
    "createdAt": "2026-01-26T10:00:00.000Z",
    "updatedAt": "2026-01-26T11:00:00.000Z"
  },
  "refund": {
    "id": "456e7890-e89b-12d3-a456-426614174000",
    "paymentId": "123e4567-e89b-12d3-a456-426614174000",
    "amount": "50.00",
    "reason": "Partial refund for damaged item",
    "createdAt": "2026-01-26T11:00:00.000Z"
  }
}
```

### Multiple Partial Refunds

```bash
# First partial refund
curl -X POST http://localhost:3000/payments/123e4567-e89b-12d3-a456-426614174000/refund \
  -d '{"amount": 30}'

# Second partial refund
curl -X POST http://localhost:3000/payments/123e4567-e89b-12d3-a456-426614174000/refund \
  -d '{"amount": 20}'

# Third refund completes the full refund
curl -X POST http://localhost:3000/payments/123e4567-e89b-12d3-a456-426614174000/refund \
  -d '{"amount": 50}'
# Status changes to REFUNDED
```

## Retrieving Refunds

Get payment details including all refunds:

```bash
curl http://localhost:3000/payments/123e4567-e89b-12d3-a456-426614174000
```

Response includes refunds array:
```json
{
  "id": "123e4567-e89b-12d3-a456-426614174000",
  "amount": "100.00",
  "currency": "USD",
  "status": "PARTIALLY_REFUNDED",
  "refundedAmount": "50.00",
  "refunds": [
    {
      "id": "refund-1",
      "amount": "30.00",
      "reason": "First refund",
      "createdAt": "2026-01-26T11:00:00.000Z"
    },
    {
      "id": "refund-2",
      "amount": "20.00",
      "reason": "Second refund",
      "createdAt": "2026-01-26T11:05:00.000Z"
    }
  ]
}
```

## Error Responses

### 404 - Payment Not Found
```json
{
  "statusCode": 404,
  "message": "Payment with ID 123e4567-e89b-12d3-a456-426614174000 not found",
  "error": "Not Found"
}
```

### 409 - Cannot Refund Pending Payment
```json
{
  "statusCode": 409,
  "message": "Cannot refund a payment that is still pending",
  "error": "Conflict"
}
```

### 409 - Already Fully Refunded
```json
{
  "statusCode": 409,
  "message": "Payment is already fully refunded",
  "error": "Conflict"
}
```

### 409 - Refund Exceeds Remaining Amount
```json
{
  "statusCode": 409,
  "message": "Refund amount 60 exceeds remaining refundable amount 40",
  "error": "Conflict"
}
```

## Business Rules

1. Only COMPLETED or PARTIALLY_REFUNDED payments can be refunded
2. Total refunded amount cannot exceed the original payment amount
3. Full refund transitions status to REFUNDED
4. Partial refund transitions status to PARTIALLY_REFUNDED
5. All refunds are tracked in the refunds table with timestamps
6. Refunds are processed within a database transaction for consistency

## Webhooks

`refund.issued` is one of the platform's officially supported webhook event types (declared in `WEBHOOK_EVENT_TYPES`). Once registered, any Webhook Endpoint whose `events` array includes `refund.issued` will receive a delivery each time a full or partial refund is successfully processed for the endpoint's merchant. Register an endpoint via `POST /v1/webhooks` to start receiving these notifications.

### Supported Event

| Event name      | Fired when                                       | Recipients                                                                                |
| --------------- | ------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| `refund.issued` | A full or partial refund is committed to the DB  | Active Webhook Endpoints subscribed to `refund.issued` for the merchant associated with the payment |

The full list of supported event names is defined in `WEBHOOK_EVENT_TYPES` (`payment.created`, `payment.completed`, `payment.failed`, `refund.issued`, `dispute.opened`). Fan-out is independent per endpoint — there is no built-in deduplication across endpoints, so if you operate multiple endpoints you will receive multiple deliveries per refund.

### Request Headers

Every delivery includes the following headers so receivers can verify authenticity and route quickly:

| Header                  | Description                                                                                                              |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `Content-Type`          | `application/json`                                                                                                       |
| `X-FacilPay-Event`      | The event name. For refunds this is always `refund.issued`.                                                              |
| `X-FacilPay-Signature`  | Hex-encoded HMAC-SHA256 of the raw request body, keyed with the endpoint's `secret` (e.g. `whsec_...`).                  |

Verify the signature on your server by re-computing HMAC-SHA256 over the exact bytes you received, keyed with the secret returned when the endpoint was created. See the Webhooks API reference for a worked example.

### Payload Shape

The body follows the standard `{ event, timestamp, data }` envelope. `data` always contains both the freshly created `refund` record and the resulting `payment` snapshot, so consumers don't have to make a follow-up API call to reconcile state.

#### Example — Partial Refund

```json
{
  "event": "refund.issued",
  "timestamp": "2026-01-26T11:00:00.000Z",
  "data": {
    "payment": {
      "id": "123e4567-e89b-12d3-a456-426614174000",
      "amount": "100.00",
      "currency": "USD",
      "status": "PARTIALLY_REFUNDED",
      "refundedAmount": "50.00",
      "externalReference": "order-12345",
      "createdAt": "2026-01-26T10:00:00.000Z",
      "updatedAt": "2026-01-26T11:00:00.000Z"
    },
    "refund": {
      "id": "456e7890-e89b-12d3-a456-426614174000",
      "paymentId": "123e4567-e89b-12d3-a456-426614174000",
      "amount": "50.00",
      "reason": "Customer requested partial refund",
      "createdAt": "2026-01-26T11:00:00.000Z"
    }
  }
}
```

#### Example — Full Refund (single refund that exhausts the payment)

```json
{
  "event": "refund.issued",
  "timestamp": "2026-01-26T11:00:00.000Z",
  "data": {
    "payment": {
      "id": "123e4567-e89b-12d3-a456-426614174000",
      "amount": "100.00",
      "currency": "USD",
      "status": "REFUNDED",
      "refundedAmount": "100.00"
    },
    "refund": {
      "id": "456e7890-e89b-12d3-a456-426614174000",
      "paymentId": "123e4567-e89b-12d3-a456-426614174000",
      "amount": "100.00",
      "reason": "Customer requested refund",
      "createdAt": "2026-01-26T11:00:00.000Z"
    }
  }
}
```

> **Schema note:** the canonical envelope is `{ event, timestamp, data }`. The fields shown inside `data.payment` and `data.refund` mirror the persisted entity state at the moment of dispatch — `data.refund` describes only the **single** refund event that just fired, while `data.payment.refundedAmount` is the cumulative total across every refund for the payment.

### Delivery Semantics

- **Trigger:** The webhook is only fired once the refund (and the corresponding payment-status update) has been committed in the database transaction. If the refund throws a `4xx`/`5xx`, no webhooks are dispatched.
- **Fan-out per merchant:** Every active endpoint subscribed to `refund.issued` for the relevant merchant receives an independent delivery — there is no deduplication across endpoints.
- **Timeout:** Each delivery attempt has a 10 second timeout. Non-2xx responses and timeouts are treated as failures.
- **Retries:** Failures are retried up to **5** times (6 total attempts) with exponential backoff starting at 1 second.
- **Dead-letter:** After 6 failed attempts the delivery is marked `DEAD_LETTER` and stops retrying automatically. It can be re-queued with `POST /v1/webhooks/deliveries/:deliveryId/retry`.

### Receipt Checklist

To handle a `refund.issued` delivery reliably:

1. Respond with a 2xx status code **before** doing any non-trivial work — return early and process asynchronously.
2. Verify the `X-FacilPay-Signature` against the raw request body using HMAC-SHA256 and your endpoint's `secret`.
3. Use `event === 'refund.issued'` to route, and inspect `data.payment.status` to distinguish partial (`PARTIALLY_REFUNDED`) from full (`REFUNDED`) terminal states.
4. Reconcile `data.refund.amount` against `data.payment.refundedAmount` — the former is the latest single refund, the latter is the cumulative total across all refunds for the payment.

### Distinguishing Partial vs. Full Refunds

The `refund.issued` event fires **identically** for both partial and full refunds. To differentiate:

- Inspect `data.payment.status`: it is `PARTIALLY_REFUNDED` after a partial refund and `REFUNDED` once the cumulative refunded amount reaches the payment amount.
- Compare `data.payment.refundedAmount` to `data.payment.amount`: equal values mean the payment is fully refunded.

When a full refund is the result of a series of partial refunds, the most recent `refund` entry is what you receive — your integration should sum all `refund` records for a payment to reconstruct the full history (the GET payment endpoint returns the `refunds` array).

## Permissions & Role Requirements

The `POST /payments/:id/refund` endpoint is a secured route requiring a valid Bearer authentication token. Access controls are handled by the system's `RolesGuard` mapping.

Because no localized role overrides are explicitly bound to the refund method, any authenticated user profile with a valid system token can trigger a refund:

| Role | Permission Level | Can Issue Refunds? |
| :--- | :--- | :--- |
| **`ADMIN`** | Complete Workspace Access | **Yes** |
| **`USER`** | Base Account Access | **Yes** |

### Authentication Contract
Requests must include a valid JSON Web Token (JWT) in the header metadata:
```http
Authorization: Bearer <your_jwt_token>
```
Failure to provide a valid token results in a `401 Unauthorized` response contract.

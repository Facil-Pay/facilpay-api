# Webhooks

## Overview

FacilPay delivers real-time HTTP POST notifications to merchant-registered endpoints whenever key events occur (payments, refunds, disputes). Each delivery includes a cryptographic signature so receivers can verify authenticity without sharing credentials over the wire.

All webhook management endpoints live under `/v1/webhooks` and require a valid JWT.

## Supported Event Types

| Event                    | Fired when                                   |
| ------------------------ | -------------------------------------------- |
| `payment.created`        | A new payment is initiated                   |
| `payment.completed`      | A payment settles successfully               |
| `payment.failed`         | A payment attempt fails                      |
| `payment.expired`        | A payment expires without completion         |
| `payment.split_processed`| A split payment is processed                 |
| `refund.issued`          | A full or partial refund is committed        |
| `dispute.opened`         | A dispute is opened on a payment             |

## Endpoint Management

All routes require `Authorization: Bearer <jwt>`. Merchants can only manage their own endpoints.

### Register an Endpoint

```
POST /v1/webhooks
```

**Request Body**

```json
{
  "url": "https://merchant.example.com/webhooks",
  "events": ["payment.created", "payment.completed"]
}
```

| Field    | Type       | Required | Description                                              |
| -------- | ---------- | -------- | -------------------------------------------------------- |
| `url`    | `string`   | Yes      | HTTPS URL that will receive POST requests                |
| `events` | `string[]` | Yes      | One or more supported event types to subscribe to        |

**Response — `201 Created`**

```json
{
  "id": "123e4567-e89b-12d3-a456-426614174000",
  "merchantId": "abc123",
  "url": "https://merchant.example.com/webhooks",
  "events": ["payment.created", "payment.completed"],
  "isActive": true,
  "secret": "whsec_abc123...",
  "createdAt": "2026-01-26T10:00:00.000Z",
  "updatedAt": "2026-01-26T10:00:00.000Z"
}
```

> **Important:** The `secret` is only returned in full when the endpoint is created (and after a secret rotation). Store it securely — it cannot be retrieved again.

**Error Responses**

| Status | Condition                                        |
| ------ | ------------------------------------------------ |
| `400`  | Invalid URL or unknown event type                |
| `401`  | Missing or invalid JWT                           |

---

### List Endpoints

```
GET /v1/webhooks
```

Returns all webhook endpoints belonging to the authenticated merchant, ordered by creation date (newest first).

**Response — `200 OK`**

```json
[
  {
    "id": "123e4567-e89b-12d3-a456-426614174000",
    "merchantId": "abc123",
    "url": "https://merchant.example.com/webhooks",
    "events": ["payment.created", "payment.completed"],
    "isActive": true,
    "secret": "whsec_abc123...",
    "createdAt": "2026-01-26T10:00:00.000Z",
    "updatedAt": "2026-01-26T10:00:00.000Z"
  }
]
```

---

### Update an Endpoint

```
PATCH /v1/webhooks/:id
```

Update the URL, event subscriptions, or active status. All fields are optional — only supplied fields are changed.

**Request Body**

```json
{
  "url": "https://merchant.example.com/webhooks/v2",
  "events": ["payment.completed", "refund.issued"],
  "isActive": false
}
```

| Field      | Type       | Required | Description                                         |
| ---------- | ---------- | -------- | --------------------------------------------------- |
| `url`      | `string`   | No       | New HTTPS URL                                       |
| `events`   | `string[]` | No       | Replacement set of event subscriptions               |
| `isActive` | `boolean`  | No       | Enable or disable without deleting                  |

**Response — `200 OK`**

Returns the full updated endpoint object.

**Error Responses**

| Status | Condition                            |
| ------ | ------------------------------------ |
| `400`  | Validation failed                    |
| `401`  | Missing or invalid JWT               |
| `403`  | Endpoint belongs to another merchant |
| `404`  | Endpoint not found                   |

---

### Delete an Endpoint

```
DELETE /v1/webhooks/:id
```

Permanently removes the webhook endpoint and cascades to its delivery records.

**Response — `204 No Content`**

**Error Responses**

| Status | Condition                            |
| ------ | ------------------------------------ |
| `401`  | Missing or invalid JWT               |
| `403`  | Endpoint belongs to another merchant |
| `404`  | Endpoint not found                   |

---

### Rotate Signing Secret

```
POST /v1/webhooks/:id/rotate-secret
```

Generates a new `whsec_` signing secret. The previous secret stops validating new deliveries immediately. The new secret is returned exactly once in the response — store it securely.

**Response — `200 OK`**

Returns the full endpoint object with the new `secret`.

**Error Responses**

| Status | Condition                            |
| ------ | ------------------------------------ |
| `401`  | Missing or invalid JWT               |
| `403`  | Endpoint belongs to another merchant |
| `404`  | Endpoint not found                   |

## Payload Envelope

Every webhook delivery uses the same envelope:

```json
{
  "event": "payment.completed",
  "timestamp": "2026-01-26T10:05:00.000Z",
  "data": {
    "...event-specific fields..."
  }
}
```

| Field       | Type     | Description                                  |
| ----------- | -------- | -------------------------------------------- |
| `event`     | `string` | The event type (e.g. `payment.completed`)    |
| `timestamp` | `string` | ISO-8601 UTC timestamp of when the event was dispatched |
| `data`      | `object` | Event-specific payload (entity snapshots)    |

The `data` object mirrors the persisted entity state at the moment of dispatch — consumers can use it directly without a follow-up API call.

## Request Headers

Every delivery includes these headers:

| Header                  | Description                                                                     |
| ----------------------- | ------------------------------------------------------------------------------- |
| `Content-Type`          | Always `application/json`                                                       |
| `X-FacilPay-Event`      | The event name (e.g. `payment.completed`)                                       |
| `X-FacilPay-Signature`  | Hex-encoded HMAC-SHA256 of the raw JSON body, keyed with the endpoint's `secret` |

## Signature Verification

FacilPay signs every delivery so you can verify that it came from us and wasn't tampered with.

### How It Works

1. The raw JSON body is serialized with `JSON.stringify(payload)`.
2. An HMAC-SHA256 digest is computed using the endpoint's `secret` (the `whsec_...` value returned at creation) as the key.
3. The hex-encoded result is sent in the `X-FacilPay-Signature` header.

### Verifying in Node.js

```javascript
const crypto = require('crypto');

function verifyWebhook(rawBody, signature, secret) {
  const expected = crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex');

  // Use constant-time comparison to prevent timing attacks
  return crypto.timingSafeEqual(
    Buffer.from(signature, 'hex'),
    Buffer.from(expected, 'hex'),
  );
}

// In your Express handler:
app.post('/webhooks', express.text({ type: 'application/json' }), (req, res) => {
  const signature = req.headers['x-facilpay-signature'];
  const isValid = verifyWebhook(req.body, signature, process.env.WEBHOOK_SECRET);

  if (!isValid) {
    return res.status(401).send('Invalid signature');
  }

  // Process the event...
  res.status(200).send('OK');
});
```

### Verifying in Python

```python
import hmac
import hashlib

def verify_webhook(raw_body: bytes, signature: str, secret: str) -> bool:
    expected = hmac.new(
        secret.encode(),
        raw_body,
        hashlib.sha256,
    ).hexdigest()
    return hmac.compare_digest(signature, expected)
```

> **Security note:** Always use constant-time comparison (`crypto.timingSafeEqual` / `hmac.compare_digest`) to prevent timing attacks. Do **not** use `===` or `==` for signature comparison.

## Delivery Pipeline

### Architecture

Webhook deliveries are processed asynchronously via a **BullMQ** queue (named `webhooks`), backed by Redis. This decouples event emission from HTTP delivery and provides built-in retry capabilities.

**Flow:**

```
Event emitted
  → WebhooksService creates a WebhookDelivery record (status: pending)
  → Job added to BullMQ "webhooks" queue
  → WebhooksProcessor picks up the job
  → POST to endpoint URL with signed payload
  → Success? → status: success
  → Failure? → retry with exponential backoff (up to 5 retries)
  → All retries exhausted? → status: dead-letter
```

### Retry & Backoff Behavior

| Setting           | Value                                     |
| ----------------- | ----------------------------------------- |
| Max attempts      | **6** (1 initial + 5 retries)             |
| Backoff type      | Exponential                               |
| Base delay        | 1 second                                  |
| Timeout per attempt | 10 seconds                              |

Approximate retry schedule:

| Attempt | Delay after previous failure |
| ------- | ---------------------------- |
| 1       | (immediate)                  |
| 2       | ~1 s                         |
| 3       | ~2 s                         |
| 4       | ~4 s                         |
| 5       | ~8 s                         |
| 6       | ~16 s                        |

A delivery is treated as failed if the endpoint returns a non-2xx status code, times out (> 10 s), or a connection error occurs.

### Delivery Statuses

| Status        | Description                                                    |
| ------------- | -------------------------------------------------------------- |
| `pending`     | Delivery created, awaiting processing or retrying              |
| `success`     | Endpoint returned a 2xx response                               |
| `failed`      | Most recent attempt failed; more retries may follow            |
| `dead-letter` | All 6 attempts exhausted — delivery will not retry automatically |

### Dead-Lettering

After 6 consecutive failures a delivery is marked `dead-letter` and removed from the automatic retry cycle. Dead-lettered deliveries remain in the database for inspection and can be manually re-queued (see below).

## Manual Retry

```
POST /v1/webhooks/deliveries/:deliveryId/retry
```

Re-queues a `failed` or `dead-letter` delivery for a fresh 6-attempt cycle. The delivery status is reset to `pending`.

**Response — `200 OK`**

**Error Responses**

| Status | Condition                                          |
| ------ | -------------------------------------------------- |
| `403`  | Delivery is not in `failed` or `dead-letter` status |
| `404`  | Delivery not found                                 |

**Example**

```bash
curl -X POST https://api.facilpay.com/v1/webhooks/deliveries/456e7890-e89b-12d3-a456-426614174000/retry \
  -H "Authorization: Bearer <jwt>"
```

## Test Delivery

```
POST /v1/webhooks/:id/test
```

Fires a synthetic `test` event to the registered URL. Use this to verify your endpoint is reachable and your signature verification logic works correctly.

The test delivery goes through the same BullMQ pipeline (including signature and retries) as real deliveries.

**Sample Payload**

```json
{
  "event": "test",
  "timestamp": "2026-01-26T12:00:00.000Z",
  "data": {
    "message": "This is a test event from FacilPay",
    "endpointId": "123e4567-e89b-12d3-a456-426614174000"
  }
}
```

**Response — `200 OK`**

```json
{
  "delivered": false,
  "statusCode": null,
  "error": "Queued for delivery"
}
```

> **Note:** Because the test event is processed asynchronously via the queue, the immediate response indicates the delivery has been queued, not that it has been delivered. Monitor the delivery status via your endpoint's incoming requests.

**Error Responses**

| Status | Condition                            |
| ------ | ------------------------------------ |
| `401`  | Missing or invalid JWT               |
| `403`  | Endpoint belongs to another merchant |
| `404`  | Endpoint not found                   |

## Best-Practice Receipt Checklist

1. **Return 2xx immediately.** Perform any non-trivial processing asynchronously — the delivery will time out after 10 seconds.
2. **Verify the signature.** Compute HMAC-SHA256 of the raw request body with your endpoint secret and compare against `X-FacilPay-Signature` using constant-time comparison.
3. **Route on the event.** Use the `event` field (or the `X-FacilPay-Event` header) to dispatch to the appropriate handler.
4. **Deduplicate.** If your handler is not idempotent, track delivery IDs or data identifiers to avoid processing the same event twice (retries will re-deliver the same payload).
5. **Handle secret rotation gracefully.** During rotation, briefly accept signatures from both old and new secrets to avoid rejecting in-flight deliveries.
6. **Monitor dead letters.** Set up alerts for deliveries that reach `dead-letter` status — they indicate persistent connectivity or server issues on your end.

## Authentication & Permissions

All webhook management endpoints require a valid JWT in the `Authorization` header:

```http
Authorization: Bearer <your_jwt_token>
```

Ownership is enforced at the service layer — merchants can only create, view, update, and delete their own endpoints. Attempting to access another merchant's endpoint returns `403 Forbidden`.

| Role       | Can manage webhooks? |
| ---------- | -------------------- |
| **ADMIN**  | Yes                  |
| **USER**   | Yes                  |

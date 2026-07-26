# Payment Dispute Management

This document describes the payment dispute management functionality in FacilPay API.

## Overview

The dispute management system allows merchants and payers to raise and resolve payment disputes. It provides a structured workflow for handling payment disagreements with proper status tracking, notifications, and webhook integrations.

## Dispute Statuses

Disputes follow a defined lifecycle with the following statuses:

- **`open`** - Dispute has been created and is awaiting review
- **`under_review`** - Dispute is being investigated
- **`resolved`** - Dispute has been resolved (with resolution notes)
- **`closed`** - Dispute has been closed (final state)

### Valid Status Transitions

```
open → under_review → resolved → closed
  ↓         ↓
  └─────────┴──→ closed
```

## Dispute Reasons

When creating a dispute, one of the following reasons must be provided:

- **`fraud`** - Fraudulent transaction
- **`duplicate`** - Duplicate payment
- **`product_not_received`** - Product or service was not delivered
- **`product_not_as_described`** - Product or service differs from description
- **`unauthorized`** - Unauthorized transaction
- **`other`** - Other reason (requires description)

## API Endpoints

### 1. Open a Dispute

Opens a new dispute for a completed or partially refunded payment.

```http
POST /v1/payments/:id/dispute
Authorization: Bearer <token>
Content-Type: application/json

{
  "reason": "fraud",
  "description": "Unauthorized transaction on my card",
  "openedBy": "customer@example.com"
}
```

**Response** (201 Created):

```json
{
  "id": "789e4567-e89b-12d3-a456-426614174000",
  "paymentId": "123e4567-e89b-12d3-a456-426614174000",
  "status": "open",
  "reason": "fraud",
  "description": "Unauthorized transaction on my card",
  "disputedAmount": "100.00",
  "openedBy": "customer@example.com",
  "createdAt": "2026-01-26T12:00:00.000Z",
  "updatedAt": "2026-01-26T12:00:00.000Z"
}
```

**Error Responses:**

- `400 Bad Request` - Validation failed (missing required fields, invalid reason)
- `404 Not Found` - Payment not found
- `409 Conflict` - Payment cannot be disputed (not in COMPLETED or PARTIALLY_REFUNDED status, or active dispute already exists)

**Notes:**
- Only one active dispute (non-terminal status) can exist per payment
- Only payments with status `COMPLETED` or `PARTIALLY_REFUNDED` can be disputed
- The `disputedAmount` is automatically calculated as the remaining refundable amount

### 2. List Disputes

Returns a list of disputes with optional filtering.

```http
GET /v1/disputes?status=open&paymentId=123e4567-e89b-12d3-a456-426614174000
Authorization: Bearer <token>
```

**Query Parameters:**

- `status` (optional) - Filter by dispute status (`open`, `under_review`, `resolved`, `closed`)
- `paymentId` (optional) - Filter by payment UUID

**Response** (200 OK):

```json
[
  {
    "id": "789e4567-e89b-12d3-a456-426614174000",
    "paymentId": "123e4567-e89b-12d3-a456-426614174000",
    "status": "open",
    "reason": "fraud",
    "description": "Unauthorized transaction on my card",
    "disputedAmount": "100.00",
    "openedBy": "customer@example.com",
    "createdAt": "2026-01-26T12:00:00.000Z",
    "updatedAt": "2026-01-26T12:00:00.000Z"
  }
]
```

### 3. Get Dispute by ID

Returns a single dispute by its UUID.

```http
GET /v1/disputes/:id
Authorization: Bearer <token>
```

**Response** (200 OK):

```json
{
  "id": "789e4567-e89b-12d3-a456-426614174000",
  "paymentId": "123e4567-e89b-12d3-a456-426614174000",
  "status": "under_review",
  "reason": "fraud",
  "description": "Unauthorized transaction on my card",
  "disputedAmount": "100.00",
  "openedBy": "customer@example.com",
  "resolutionNotes": "Reviewing transaction evidence",
  "resolvedBy": "admin@example.com",
  "resolvedAt": "2026-01-26T13:00:00.000Z",
  "createdAt": "2026-01-26T12:00:00.000Z",
  "updatedAt": "2026-01-26T13:00:00.000Z"
}
```

**Error Responses:**

- `404 Not Found` - Dispute not found

### 4. Update Dispute Status (Admin Only)

Updates the status of a dispute. Only administrators can perform this action.

```http
PATCH /v1/disputes/:id
Authorization: Bearer <token>
Content-Type: application/json

{
  "status": "under_review",
  "resolutionNotes": "Reviewing transaction evidence",
  "resolvedBy": "admin@example.com"
}
```

**Response** (200 OK):

```json
{
  "id": "789e4567-e89b-12d3-a456-426614174000",
  "paymentId": "123e4567-e89b-12d3-a456-426614174000",
  "status": "under_review",
  "reason": "fraud",
  "description": "Unauthorized transaction on my card",
  "disputedAmount": "100.00",
  "openedBy": "customer@example.com",
  "resolutionNotes": "Reviewing transaction evidence",
  "resolvedBy": null,
  "createdAt": "2026-01-26T12:00:00.000Z",
  "updatedAt": "2026-01-26T13:00:00.000Z"
}
```

**Error Responses:**

- `400 Bad Request` - Invalid status transition
- `403 Forbidden` - Insufficient permissions (non-admin)
- `404 Not Found` - Dispute not found
- `409 Conflict` - Invalid status transition

**Notes:**
- When status is changed to `resolved`, the `resolvedAt` timestamp is automatically set
- When status is changed to `closed`, the `closedAt` timestamp is automatically set
- Status transitions are validated to ensure proper workflow progression

## Email Notifications

The system automatically sends email notifications to relevant parties when:

1. **Dispute Opened** - Sent to both merchant and payer
   - Subject: `Dispute Opened: {amount} {currency}`
   - Includes dispute ID, payment ID, amount, and reason

2. **Dispute Status Changed** - Sent to both merchant and payer
   - Subject: `Dispute Status Updated: {new_status}`
   - Includes previous status, new status, and resolution notes (if available)

### Email Templates

- `merchant-dispute-opened.hbs` - Merchant notification for new dispute
- `payer-dispute-opened.hbs` - Payer notification for new dispute
- `merchant-dispute-status-changed.hbs` - Merchant notification for status change
- `payer-dispute-status-changed.hbs` - Payer notification for status change

## Webhooks

Webhooks are fired automatically when dispute status changes. The webhook payload includes:

```json
{
  "event": "dispute.opened",
  "timestamp": "2026-01-26T12:00:00.000Z",
  "data": {
    "disputeId": "789e4567-e89b-12d3-a456-426614174000",
    "paymentId": "123e4567-e89b-12d3-a456-426614174000",
    "status": "open",
    "reason": "fraud",
    "disputedAmount": "100.00",
    "timestamp": "2026-01-26T12:00:00.000Z"
  }
}
```

### Webhook Events

- `dispute.opened` - Fired when a new dispute is created
- `dispute.under_review` - Fired when dispute status changes to under_review
- `dispute.resolved` - Fired when dispute status changes to resolved
- `dispute.closed` - Fired when dispute status changes to closed

## Database Schema

### Disputes Table

```sql
CREATE TABLE disputes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  "paymentId" UUID NOT NULL,
  status dispute_status DEFAULT 'open',
  reason dispute_reason NOT NULL,
  description TEXT,
  "disputedAmount" DECIMAL(10,2),
  "openedBy" VARCHAR(255),
  "resolutionNotes" TEXT,
  "resolvedBy" VARCHAR(255),
  "merchantEmail" VARCHAR(255),
  "payerEmail" VARCHAR(255),
  "createdAt" TIMESTAMP DEFAULT now(),
  "updatedAt" TIMESTAMP DEFAULT now(),
  "resolvedAt" TIMESTAMP,
  "closedAt" TIMESTAMP,
  FOREIGN KEY ("paymentId") REFERENCES payments(id) ON DELETE CASCADE
);

CREATE INDEX IDX_disputes_paymentId ON disputes("paymentId");
CREATE INDEX IDX_disputes_status ON disputes(status);
CREATE INDEX IDX_disputes_createdAt ON disputes("createdAt");
```

## Business Rules

1. **Payment Eligibility**: Only payments with status `COMPLETED` or `PARTIALLY_REFUNDED` can be disputed
2. **Active Dispute Limit**: Only one active dispute (non-terminal status) can exist per payment
3. **Status Transitions**: Strict validation of status transitions to maintain workflow integrity
4. **Automatic Timestamps**: `resolvedAt` and `closedAt` are automatically set when status changes to `resolved` or `closed`
5. **Disputed Amount**: Automatically calculated as the remaining refundable amount (payment amount - already refunded amount)
6. **Email Notifications**: Sent asynchronously via BullMQ queue with retry logic
7. **Webhooks**: Dispatched to all registered merchant webhook endpoints

## Error Handling

All errors follow a consistent format:

```json
{
  "statusCode": 409,
  "message": "Cannot open dispute for payment with status PENDING. Only completed or partially refunded payments can be disputed.",
  "error": "Conflict"
}
```

## Testing

E2E tests are available in `test/disputes.e2e-spec.ts` and cover:

- Opening disputes for eligible payments
- Rejecting disputes for ineligible payments
- Preventing duplicate active disputes
- Listing and filtering disputes
- Getting disputes by ID
- Updating dispute status (admin only)
- Validating status transitions

Run tests with:

```bash
cd facilpay-api
npm test
```

## Migration

To apply the database migration:

```bash
cd facilpay-api
npm run migration:run
```

The migration file is `src/migrations/1751400000000-CreateDisputesTable.ts`.

## Security

- All endpoints require JWT authentication
- Only administrators can update dispute status (PATCH endpoint)
- Webhook endpoints are protected by signature verification
- Email notifications include unsubscribe links for payers

## Integration Points

- **Payments Module**: Disputes are linked to payments via foreign key
- **Notifications Module**: Email notifications are sent via BullMQ queue
- **Webhooks Module**: Webhook events are dispatched to registered endpoints
- **Auth Module**: JWT authentication and role-based access control
# Checkout Sessions - Advanced Configuration & Analytics

## Overview

This document covers advanced configuration options and analytics capabilities for checkout sessions beyond basic session creation and payment completion.

## Session Expiration Management

### Automatic Expiry

Checkout sessions automatically expire after a configurable duration (default: 30 minutes). Expired sessions transition to the `EXPIRED` status and cannot accept new payments.

**Expiration Flow**:
1. Session created with `expiresAt` timestamp (default: now + 30 minutes)
2. Cron job runs periodically to mark expired sessions
3. Expired sessions emit `checkout.session.expired` webhook event
4. Subsequent payment attempts on expired sessions return `410 Gone`

**Query for expired sessions**:
```sql
SELECT * FROM checkout_sessions 
WHERE status = 'OPEN' 
AND expiresAt < NOW()
AND merchantId = $1
```

### Manual Session Expiry

Merchants can manually expire a session before its scheduled expiration:

```
POST /v1/checkout/sessions/:id/expire
Authorization: Bearer {jwt}
```

**Response** (200 OK):
```json
{
  "id": "session-123",
  "status": "EXPIRED",
  "expiresAt": "2026-01-15T10:30:00Z",
  "updatedAt": "2026-01-15T10:25:00Z"
}
```

**Error Cases**:
- `404 Not Found`: Session does not exist or belongs to another merchant
- `409 Conflict`: Session already expired or completed

## Session Status Lifecycle

```
OPEN
├─ (payment received) → COMPLETE
├─ (session expires) → EXPIRED
└─ (manual expiry) → EXPIRED

COMPLETE
└─ (terminal state - no transitions)

EXPIRED
└─ (terminal state - no transitions)
```

### Status Descriptions

| Status   | Meaning                                          | Payment Allowed? |
| -------- | ------------------------------------------------ | ---------------- |
| OPEN     | Active, accepting payments                       | ✅ Yes           |
| COMPLETE | Payment received, order fulfilled                | ❌ No            |
| EXPIRED  | Session time expired or manually closed          | ❌ No            |

## Line Item Validation

### Server-Side Total Computation

Line item totals are **always** computed server-side to prevent tampering:

```typescript
const total = lineItems.reduce((sum, item) => {
  // Validate quantity and unit amount
  if (item.quantity < 1 || item.unitAmount < 0) {
    throw new BadRequestException('Invalid quantity or amount');
  }
  return sum + (item.quantity * item.unitAmount);
}, 0);

// Verify total matches request (if provided)
if (requestTotal && requestTotal !== total) {
  throw new BadRequestException('Total mismatch');
}
```

### Line Item Structure

Each line item must include:
- `name` (required): Display name, 1-255 characters
- `description` (optional): Additional details, 0-500 characters
- `quantity` (required): Integer ≥ 1
- `unitAmount` (required): Integer ≥ 0 (in smallest currency unit)

**Example**:
```json
{
  "name": "Premium Widget",
  "description": "Blue, size large",
  "quantity": 2,
  "unitAmount": 2999
}
```

Amount represents cents (USD) or smallest divisible unit for the currency.

## Customer Identification

### Optional Customer Data

Sessions can associate with a customer:

```json
{
  "customerId": "cus_123abc",
  "customerEmail": "customer@example.com"
}
```

**Purpose**:
- Track repeat customers
- Pre-fill checkout form
- Send order confirmation email
- Link to customer's payment history

### Email Validation

If `customerEmail` is provided:
- Must be valid RFC 5322 email format
- Trimmed and lowercased
- Used for order confirmations and receipts

## Redirect URL Configuration

### Success URL

Merchant-provided URL where customer is redirected after successful payment:

```
GET https://merchant.example.com/success?session_id=sess_123&payment_id=pay_456
```

**Validation**:
- Must be valid HTTPS URL
- Cannot point to private/local IP ranges
- Max length: 2048 characters
- No credentials in URL (user:pass removed)

**Payment ID Substitution**:
If URL contains `{PAYMENT_ID}` placeholder, it is replaced:
- Request: `successUrl: "https://example.com/success?id={PAYMENT_ID}"`
- Redirect: `https://example.com/success?id=pay_456`

### Cancel URL

Merchant-provided URL where customer is redirected if they cancel:

```
GET https://merchant.example.com/cancelled?session_id=sess_123
```

**Validation**: Same as success URL

**Triggers**:
- Customer clicks "Cancel" button on checkout
- Customer navigates back without completing payment
- Payment gateway declines the transaction

## Currency & Amount Constraints

### Supported Currencies

Sessions support all ISO 4217 currency codes:

```json
{
  "currency": "USD",  // 2-letter or 3-letter codes
  "lineItems": [...]
}
```

### Amount Constraints

- **Minimum**: 0 (zero-amount sessions for testing)
- **Maximum**: Depends on currency and payment processor limits
- **Precision**: Integer values only (amounts in smallest currency unit)

**Currency Validation**:
```typescript
const validCurrencies = ['USD', 'EUR', 'GBP', ...]; // ISO 4217
if (!validCurrencies.includes(currency.toUpperCase())) {
  throw new BadRequestException('Unsupported currency');
}
```

## Checkout Session Retrieval

### Merchant Access (Authenticated)

Retrieve session details for sessions owned by the authenticated merchant:

```
GET /v1/checkout/sessions/:id
Authorization: Bearer {jwt}
```

**Response** (200 OK):
```json
{
  "id": "sess_123",
  "merchantId": "merchant_456",
  "status": "OPEN",
  "lineItems": [
    {
      "name": "Product A",
      "quantity": 1,
      "unitAmount": 1999
    }
  ],
  "currency": "USD",
  "total": 1999,
  "customerId": "cus_789",
  "customerEmail": "customer@example.com",
  "successUrl": "https://merchant.example.com/success?id={PAYMENT_ID}",
  "cancelUrl": "https://merchant.example.com/cancelled",
  "expiresAt": "2026-01-15T10:30:00Z",
  "paymentId": null,
  "createdAt": "2026-01-15T10:00:00Z",
  "updatedAt": "2026-01-15T10:00:00Z"
}
```

**Errors**:
- `404 Not Found`: Session does not exist or belongs to another merchant
- `401 Unauthorized`: Missing or invalid authentication token

### Public Access (Unauthenticated)

Payers access checkout via public URL with limited information:

```
GET /v1/checkout/sessions/:publicId/public
```

**Response** (200 OK):
```json
{
  "id": "sess_123",
  "status": "OPEN",
  "lineItems": [
    {
      "name": "Product A",
      "quantity": 1,
      "unitAmount": 1999
    }
  ],
  "currency": "USD",
  "total": 1999,
  "customerEmail": "customer@example.com",
  "merchantDisplayName": "Acme Corp"
}
```

**Security Note**: Public endpoint returns only necessary data for checkout display; merchant ID, internal IDs, and private URLs are excluded.

## Webhook Events

### Session Completion

When a payment is successfully received for a checkout session:

```json
{
  "type": "checkout.session.completed",
  "data": {
    "sessionId": "sess_123",
    "paymentId": "pay_456",
    "status": "COMPLETE",
    "amount": 1999,
    "currency": "USD",
    "customerEmail": "customer@example.com",
    "timestamp": "2026-01-15T10:15:00Z"
  }
}
```

### Session Expiry

When a session expires (scheduled or manual):

```json
{
  "type": "checkout.session.expired",
  "data": {
    "sessionId": "sess_123",
    "reason": "manual",
    "expiredAt": "2026-01-15T10:30:00Z",
    "timestamp": "2026-01-15T10:30:00Z"
  }
}
```

**Reason Values**:
- `timeout`: Session reached expiration time
- `manual`: Merchant manually expired the session

## Testing & Integration

### Zero-Amount Sessions

For testing checkout flows without charging:

```json
{
  "lineItems": [
    {
      "name": "Test Product",
      "quantity": 1,
      "unitAmount": 0
    }
  ],
  "currency": "USD",
  "customerId": "test_123"
}
```

### Test Mode

In test mode, sessions can be completed without actual payment:

```
POST /v1/checkout/sessions/:id/test-complete
Authorization: Bearer {jwt}
```

This allows end-to-end testing of session lifecycle without live payment processing.

## Error Reference

| Error                          | HTTP Status | Cause                                    |
| ------------------------------ | ----------- | ---------------------------------------- |
| Invalid currency               | 400         | Unsupported ISO 4217 currency code       |
| Line items missing             | 400         | No line items provided in request        |
| Invalid line item quantity     | 400         | Quantity < 1 or non-integer              |
| Invalid amount                 | 400         | Negative amount or exceeded maximum      |
| Invalid URL format             | 400         | successUrl/cancelUrl not valid HTTPS     |
| Unsafe URL                     | 400         | URL points to private IP or contains credentials |
| Session not found              | 404         | Session ID does not exist                |
| Session expired                | 410         | Cannot accept payment for expired session |
| Session already completed      | 409         | Cannot modify completed session          |
| Unauthorized                   | 403         | Merchant accessing another's session     |

## Best Practices

1. **Always validate totals server-side**: Never trust client-provided totals
2. **Use HTTPS for redirect URLs**: Sensitive data should only travel over encrypted connections
3. **Handle session expiry gracefully**: Show user-friendly messages for expired sessions
4. **Store session IDs**: Reference sessions in your order management system
5. **Implement idempotency**: Session creation should be idempotent using Idempotency-Key header
6. **Monitor webhook delivery**: Ensure session completion webhooks are processed
7. **Set appropriate expiration times**: Balance user experience with security (30 min default is recommended)

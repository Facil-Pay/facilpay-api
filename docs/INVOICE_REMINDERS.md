# Invoice Reminders

## Overview

Invoice reminders automatically email customers when an invoice is approaching, on, or past its due date. This reduces manual follow-up work and improves payment collection rates. Merchants can configure reminder timing at both the global and per-invoice level.

---

## Invoice Reminder States

Invoices transition through the following states based on the due date:

```
PENDING (created) 
    ↓
OVERDUE (if dueDate < now and not paid)
    ↓
COMPLETED (paid) or CANCELLED
```

---

## Reminder Object

```json
{
  "id": "reminder_abc123def456",
  "paymentId": "payment-uuid",
  "type": "BEFORE",
  "sentAt": "2026-01-12T08:00:00.000Z",
  "createdAt": "2026-01-12T08:00:00.000Z"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `id` | String | Unique reminder record identifier |
| `paymentId` | UUID | Associated payment/invoice identifier |
| `type` | String | Reminder type: `BEFORE`, `ON_DUE`, or `AFTER` |
| `sentAt` | Date | When the reminder email was sent |
| `createdAt` | Date | Record creation timestamp |

---

## Reminder Types

### BEFORE Reminders

Sent before the due date (default: 3 days before).

**Email Subject**: "Reminder: Invoice due in 3 days"

**Trigger**: Payment has `dueDate` set and date is 3 days before due date

**Example**:
```
Invoice Due Date: 2026-01-15
BEFORE Reminder Sent: 2026-01-12 (3 days before)
```

---

### ON_DUE Reminders

Sent on the due date.

**Email Subject**: "Invoice due today"

**Trigger**: Payment date matches today's date

**Example**:
```
Invoice Due Date: 2026-01-15
ON_DUE Reminder Sent: 2026-01-15 (on the day)
```

---

### AFTER Reminders

Sent after the due date (default: 7 days after, when marked OVERDUE).

**Email Subject**: "Urgent: Invoice overdue by 7 days"

**Trigger**: Payment marked as OVERDUE and AFTER reminder not yet sent

**Example**:
```
Invoice Due Date: 2026-01-15
AFTER Reminder Sent: 2026-01-22 (7 days after)
```

---

## Payment Payment Object (Enhanced)

Payment entities now include the following fields for invoice reminders:

```json
{
  "id": "payment-uuid",
  "merchantId": "merchant-uuid",
  "customerId": "customer-uuid",
  "amount": 5000,
  "currency": "USD",
  "status": "PENDING",
  "dueDate": "2026-01-15T23:59:59.000Z",
  "remindersEnabled": true,
  "createdAt": "2026-01-01T10:00:00.000Z",
  "updatedAt": "2026-01-01T10:00:00.000Z"
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `dueDate` | Date | null | Invoice due date (ISO 8601) |
| `remindersEnabled` | Boolean | true | Whether reminders are enabled for this invoice |
| `status` | String | PENDING | Payment status; includes `OVERDUE` for past-due unpaid invoices |

---

## Payment Status: OVERDUE

A new payment status indicates an invoice is past due but unpaid:

```json
{
  "id": "payment-uuid",
  "status": "OVERDUE",
  "dueDate": "2026-01-15T23:59:59.000Z",
  "overdueFor": {
    "days": 5,
    "hours": 3
  }
}
```

**Transition Logic**:
- Daily cron job runs at midnight UTC
- Queries: `status = 'PENDING' AND dueDate < NOW() AND remindersEnabled = true`
- Marks matching invoices as `OVERDUE`
- Sends `AFTER` reminder if not already sent

---

## Merchant Settings

Merchants can configure reminder behavior globally:

```json
{
  "merchantId": "merchant-uuid",
  "remindersEnabled": true,
  "reminderOffsets": [-3, 0, 7]
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `remindersEnabled` | Boolean | true | Global switch for reminders |
| `reminderOffsets` | Array | [-3, 0, 7] | Days before/on/after due date to send reminders |

---

## Email Templates

### 3 Days Before

**Subject**: `Reminder: Invoice {{invoiceNumber}} due in 3 days`

**Key Variables**:
- `{{customerName}}`: Payer's name
- `{{invoiceNumber}}`: Invoice number or payment ID
- `{{dueDate}}`: Formatted due date
- `{{amount}}`: Invoice amount
- `{{currency}}`: Currency code
- `{{merchantName}}`: Merchant's display name (from branding)

---

### On Due Date

**Subject**: `Invoice {{invoiceNumber}} due today`

**Key Variables**: Same as BEFORE reminder

---

### 7 Days After Due Date

**Subject**: `Urgent: Invoice {{invoiceNumber}} overdue`

**Key Variables**:
- `{{daysOverdue}}`: Number of days past due
- All variables from above templates

---

## API Endpoints

### GET /v1/payments/:id (Enhanced)

Retrieve a payment. Response now includes `dueDate`, `remindersEnabled`, and status includes `OVERDUE`.

```json
{
  "id": "payment-uuid",
  "merchantId": "merchant-uuid",
  "amount": 5000,
  "currency": "USD",
  "status": "OVERDUE",
  "dueDate": "2026-01-15T23:59:59.000Z",
  "remindersEnabled": true,
  "createdAt": "2026-01-01T10:00:00.000Z",
  "updatedAt": "2026-01-22T08:15:00.000Z"
}
```

---

### PATCH /v1/payments/:id/reminders

Enable or disable reminders for a specific invoice.

**Authentication**: JWT Bearer token required

**Request**:
```http
PATCH /v1/payments/payment-123/reminders HTTP/1.1
Host: api.facilpay.com
Authorization: Bearer <jwt_token>
Content-Type: application/json

{
  "enabled": false
}
```

**Response** (200 OK):
```json
{
  "id": "payment-uuid",
  "remindersEnabled": false,
  "updatedAt": "2026-01-15T10:30:00.000Z"
}
```

---

### PATCH /v1/merchants/me/settings/reminders

Update merchant-level reminder settings.

**Authentication**: JWT Bearer token required

**Request**:
```http
PATCH /v1/merchants/me/settings/reminders HTTP/1.1
Host: api.facilpay.com
Authorization: Bearer <jwt_token>
Content-Type: application/json

{
  "remindersEnabled": true,
  "reminderOffsets": [-3, 0, 7]
}
```

**Validation**:
- `reminderOffsets`: Array of integers (negative = before, 0 = on, positive = after)
- Maximum 10 offsets per merchant

**Response** (200 OK):
```json
{
  "merchantId": "merchant-uuid",
  "remindersEnabled": true,
  "reminderOffsets": [-3, 0, 7],
  "updatedAt": "2026-01-15T11:00:00.000Z"
}
```

---

### GET /v1/payments/:id/reminders

Retrieve all reminders sent for a payment:

**Response** (200 OK):
```json
{
  "paymentId": "payment-uuid",
  "total": 2,
  "reminders": [
    {
      "id": "reminder_abc123",
      "type": "BEFORE",
      "sentAt": "2026-01-12T08:00:00.000Z"
    },
    {
      "id": "reminder_def456",
      "type": "ON_DUE",
      "sentAt": "2026-01-15T08:00:00.000Z"
    }
  ]
}
```

---

## Cron Job

The system runs a daily cron job at **midnight UTC** to process reminders:

```
Cron Schedule: 0 0 * * * (Daily at 00:00 UTC)

Steps:
1. Query all PENDING invoices where:
   - dueDate < NOW()
   - remindersEnabled = true
   - merchant.remindersEnabled = true

2. Mark as OVERDUE (status change)

3. For each overdue invoice:
   - Check if AFTER reminder already sent
   - If not, queue email and create InvoiceReminder record

4. Query all invoices where:
   - dueDate matches today (current UTC date)
   - remindersEnabled = true
   - ON_DUE reminder not yet sent

5. Queue ON_DUE reminder emails

6. Query all invoices where:
   - dueDate is N days from now (based on reminderOffsets)
   - remindersEnabled = true
   - BEFORE reminder not yet sent

7. Queue BEFORE reminder emails

8. Process queued emails (background job)
```

---

## Creating an Invoice with Due Date

### POST /v1/payments (Enhanced)

Create a payment with a due date to enable reminders:

**Request**:
```http
POST /v1/payments HTTP/1.1
Host: api.facilpay.com
Authorization: Bearer <jwt_token>
Content-Type: application/json

{
  "customerId": "cus_123",
  "amount": 5000,
  "currency": "USD",
  "type": "INVOICE",
  "dueDate": "2026-02-15T23:59:59Z",
  "remindersEnabled": true,
  "description": "Invoice #INV-2026-001"
}
```

**Response** (201 Created):
```json
{
  "id": "payment-uuid",
  "customerId": "cus_123",
  "amount": 5000,
  "currency": "USD",
  "type": "INVOICE",
  "status": "PENDING",
  "dueDate": "2026-02-15T23:59:59Z",
  "remindersEnabled": true,
  "createdAt": "2026-01-15T10:00:00.000Z"
}
```

---

## Examples

### Scenario 1: Enabling Reminders for an Invoice

```bash
# Create invoice with due date (reminders enabled by default)
curl -X POST https://api.facilpay.com/v1/payments \
  -H "Authorization: Bearer <jwt_token>" \
  -H "Content-Type: application/json" \
  -d '{
    "customerId": "cus_456",
    "amount": 1000,
    "currency": "USD",
    "dueDate": "2026-02-01T23:59:59Z",
    "remindersEnabled": true
  }'

# Response includes status: "PENDING" and dueDate
```

---

### Scenario 2: Invoice Becomes Overdue

**Timeline**:
- 2026-01-29: BEFORE reminder sent (3 days before due date)
- 2026-02-01: ON_DUE reminder sent
- 2026-02-02: Midnight cron runs, invoice marked as OVERDUE
- 2026-02-09: AFTER reminder sent (7 days after due date per config)

---

### Scenario 3: Disable Reminders for Specific Invoice

```bash
curl -X PATCH https://api.facilpay.com/v1/payments/pay_789/reminders \
  -H "Authorization: Bearer <jwt_token>" \
  -H "Content-Type: application/json" \
  -d '{ "enabled": false }'
```

No further reminders will be sent for this payment.

---

### Scenario 4: Customize Merchant Reminder Settings

```bash
curl -X PATCH https://api.facilpay.com/v1/merchants/me/settings/reminders \
  -H "Authorization: Bearer <jwt_token>" \
  -H "Content-Type: application/json" \
  -d '{
    "remindersEnabled": true,
    "reminderOffsets": [-7, -1, 0, 14]
  }'
```

This sends reminders:
- 7 days before due date
- 1 day before due date
- On the due date
- 14 days after (if still unpaid)

---

## Business Rules

1. **Reminders Only Sent Once**: Each reminder type is sent only once per invoice. The `InvoiceReminder` table prevents duplicates.

2. **Disabled Invoices**: If `remindersEnabled = false`, no reminders are sent.

3. **Disabled Merchant**: If merchant-level `remindersEnabled = false`, no reminders are sent globally.

4. **Paid Invoices**: Once a payment is marked as COMPLETED, reminders stop. If an invoice is refunded, reminders are not resumed.

5. **Merchant Customization**: Merchants can customize the reminder offsets. Default is [-3, 0, 7] but can be changed to any combination.

---

## Logging and Monitoring

The system logs:
- Each reminder sent (timestamp, invoice ID, type, recipient)
- Failures (delivery errors, invalid email, etc.)
- Cron job execution (start time, invoices processed, reminders sent)

Metrics available:
- `reminder_sent_total` (counter by type: BEFORE, ON_DUE, AFTER)
- `reminder_failed_total` (counter)
- `invoices_overdue_total` (gauge)
- `reminder_processing_duration_ms` (histogram)

---

## Rate Limiting

Reminder-related endpoints follow standard merchant rate limits:
- PATCH /payments/:id/reminders: 10 requests per minute
- PATCH /merchants/me/settings/reminders: 3 requests per minute
- GET /payments/:id/reminders: 30 requests per minute

---

## Integration with Payment Timeline

Reminder events are recorded in the payment timeline:

```json
{
  "type": "reminder.sent",
  "timestamp": "2026-01-12T08:00:00.000Z",
  "data": {
    "reminderType": "BEFORE",
    "recipientEmail": "payer@example.com",
    "daysUntilDue": 3
  }
}
```

This allows you to audit all reminders sent for a payment via the payment timeline endpoint.

---

## Webhook Events

Reminder-related events are sent via webhooks:

```json
{
  "type": "invoice.overdue",
  "data": {
    "paymentId": "payment-uuid",
    "dueDate": "2026-01-15T23:59:59.000Z",
    "amountDue": 5000,
    "currency": "USD",
    "daysOverdue": 5
  }
}
```

Configure webhooks to receive these events. See [WEBHOOKS.md](./WEBHOOKS.md) for more information.

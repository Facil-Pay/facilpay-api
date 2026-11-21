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

Sent 3 days before the due date.

**Email Subject**: "Reminder: Invoice due in 3 days"

**Example**:
```
Invoice Due Date: 2026-01-15
BEFORE Reminder Sent: 2026-01-12 (3 days before)
```

---

### ON_DUE Reminders

Sent on the due date.

**Email Subject**: "Invoice due today"

**Example**:
```
Invoice Due Date: 2026-01-15
ON_DUE Reminder Sent: 2026-01-15 (on the day)
```

---

### AFTER Reminders

Sent 7 days after the due date (when invoice is overdue).

**Email Subject**: "Urgent: Invoice overdue by 7 days"

**Example**:
```
Invoice Due Date: 2026-01-15
AFTER Reminder Sent: 2026-01-22 (7 days after)
```

---

## Invoice Payment Object (Enhanced)

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

```
Dear {{customerName}},

This is a friendly reminder that invoice {{invoiceNumber}} is due on {{dueDate}}.

Amount Due: {{amount}} {{currency}}

Please arrange payment by the due date to avoid late fees.

[Link to payment page]

Thank you,
{{merchantName}}
```

---

### On Due Date

**Subject**: `Invoice {{invoiceNumber}} due today`

```
Dear {{customerName}},

Invoice {{invoiceNumber}} is due today.

Amount Due: {{amount}} {{currency}}
Due Date: {{dueDate}}

Please complete payment immediately.

[Link to payment page]

Thank you,
{{merchantName}}
```

---

### 7 Days After Due Date

**Subject**: `Urgent: Invoice {{invoiceNumber}} overdue`

```
Dear {{customerName}},

Your invoice {{invoiceNumber}} is now overdue by 7 days.

Amount Due: {{amount}} {{currency}}
Original Due Date: {{dueDate}}

Immediate payment is required to avoid service suspension or additional fees.

[Link to payment page]

Thank you,
{{merchantName}}
```

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
   - dueDate is 3 days from now
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

## Reminder History

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

### Scenario 2: Invoice Becomes Overdue

**Timeline**:
- 2026-01-29: BEFORE reminder sent (3 days before due date)
- 2026-02-01: ON_DUE reminder sent
- 2026-02-02: Midnight cron runs, invoice marked as OVERDUE
- 2026-02-02: AFTER reminder sent (7 days after original due date cron: 2026-02-08)

---

## Business Rules

1. **Reminders Only Sent Once**: Each reminder type is sent only once per invoice. The `InvoiceReminder` table prevents duplicates.

2. **Disabled Invoices**: If `remindersEnabled = false`, no reminders are sent.

3. **Disabled Merchant**: If merchant-level `remindersEnabled = false`, no reminders are sent globally.

4. **Paid Invoices**: Once a payment is marked as COMPLETED, reminders stop. If an invoice is refunded, reminders are not resumed.

5. **Merchant Customization**: Merchants can customize the reminder offsets (e.g., [-7, -1, 7] for 7 days before, 1 day before, 7 days after).

---

## Logging and Monitoring

The system logs:
- Each reminder sent (timestamp, invoice ID, type, recipient)
- Failures (delivery errors, invalid email, etc.)
- Cron job execution (start time, invoices processed, reminders sent)

Metrics:
- `reminder_sent_total` (counter by type)
- `reminder_failed_total` (counter)
- `invoices_overdue_total` (gauge)

---

## Rate Limiting

Reminder-related endpoints follow standard merchant rate limits:
- PATCH /payments/:id/reminders: 10 requests per minute
- PATCH /merchants/me/settings/reminders: 3 requests per minute
- GET /payments/:id/reminders: 30 requests per minute

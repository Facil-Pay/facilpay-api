# Payouts, Settlement Preview, and Balance History

All routes require merchant JWT authentication.

---

## Payouts Overview

Payouts allow merchants to send funds to designated destinations (bank accounts, wallets, etc.). Payouts can be submitted individually or in bulk. Each payout is tracked through its lifecycle and can be cancelled if still pending.

---

## Individual Payout Cancellation

### Endpoint

```http
POST /v1/payouts/:id/cancel
Authorization: Bearer <jwt_token>
```

**Required Scope**: `payouts:create`

**Path Parameters**:
- `id` (string, required): Payout identifier

**Response** (200 OK):
```json
{
  "id": "payout_abc123",
  "merchantId": "merchant-uuid",
  "destination": "ACCOUNT123456789",
  "amount": 1500.00,
  "currency": "USD",
  "reference": "batch-001-001",
  "memo": "Monthly settlement",
  "status": "CANCELLED",
  "createdAt": "2026-01-15T10:00:00.000Z",
  "updatedAt": "2026-01-15T15:30:00.000Z"
}
```

**Behavior**:
- Only **pending** payouts can be cancelled
- Submitted, completed, and failed payouts return `409 Conflict`
- Repeating cancellation is safe (idempotent)
- Cancelled payouts:
  - No longer consume available balance
  - No longer count against daily payout limits
  - Cannot be reactivated

**Error Responses**:
- `400 Bad Request`: Invalid payout ID format
- `404 Not Found`: Payout does not exist or not owned by merchant
- `409 Conflict`: Payout is not pending (cannot cancel non-pending payouts)
- `401 Unauthorized`: Missing or invalid JWT token

**Example**:
```bash
curl -X POST https://api.facilpay.com/v1/payouts/payout_abc123/cancel \
  -H "Authorization: Bearer <jwt_token>"
```

---

## Bulk Payout Upload

### Endpoint

```http
POST /v1/payouts/bulk
Authorization: Bearer <jwt_token>
X-Step-Up-Token: <step_up_token>
Content-Type: multipart/form-data
```

**Required Scopes**: `payouts:create`  
**Required Headers**: `X-Step-Up-Token` (for security verification)

**Form Data**:
- `file` (multipart file, required): CSV file with payout data
  - Maximum size: 1 MiB
  - Maximum rows: 1,000 data rows (plus header)

### CSV Format

**Required Headers**:
- `destination`: Bank account, wallet address, or payment destination
- `amount`: Payout amount (decimal, e.g., `1500.50`)
- `currency`: ISO 4217 currency code (e.g., `USD`, `EUR`)
- `reference`: Unique reference for this payout (within the batch and across all merchant payouts)

**Optional Headers**:
- `memo`: Additional notes or description

### CSV Example

```csv
destination,amount,currency,reference,memo
ACCT001,1500.00,USD,batch-001-001,Payment for contractor A
ACCT002,2500.00,USD,batch-001-002,Payment for contractor B
ACCT003,500.00,EUR,batch-001-003,European payment
```

### CSV Validation Rules

- **Quoting**: Quoted commas within values are supported
- **Escaping**: Escaped quotes (`\"`) are supported
- **Line endings**: CRLF and embedded newlines are handled correctly
- **References**: Must be unique within upload and across existing merchant payouts
- **Amounts**: Decimal format with up to 2 decimal places
- **Currency**: Valid ISO 4217 code or supported crypto currency

### Pre-Submission Validation

All rows, destinations, combined per-currency balances, and remaining daily limits are validated **before** any payouts or jobs are saved to the database. If validation fails, no payouts are created.

### Response

**Response** (201 Created):
```json
{
  "batchId": "batch_123abc",
  "rows": [
    {
      "row": 2,
      "payoutId": "payout_001",
      "reference": "batch-001-001",
      "status": "PENDING"
    },
    {
      "row": 3,
      "payoutId": "payout_002",
      "reference": "batch-001-002",
      "status": "PENDING"
    },
    {
      "row": 4,
      "payoutId": "payout_003",
      "reference": "batch-001-003",
      "status": "PENDING"
    }
  ]
}
```

**Field Descriptions**:
- `batchId`: Unique identifier for this batch
- `rows`: Array of uploaded payout results
- `row`: CSV record number (header = record 1, first data row = record 2)
- `payoutId`: ID of created payout
- `reference`: Reference from CSV
- `status`: Initial status (typically `PENDING`)

### Tracking Batch Payouts

Payout records retain their `batchId`. To view payouts from a specific batch:

```bash
curl 'https://api.facilpay.com/v1/payouts?batchId=batch_123abc' \
  -H "Authorization: Bearer <jwt_token>"
```

### Error Responses

- `400 Bad Request`: Invalid CSV format or validation failed
- `413 Payload Too Large`: File exceeds 1 MiB or 1,000 rows
- `401 Unauthorized`: Missing or invalid JWT token
- `403 Forbidden`: Missing `X-Step-Up-Token` or insufficient scopes

### Example

```bash
curl -X POST https://api.facilpay.com/v1/payouts/bulk \
  -H "Authorization: Bearer <jwt_token>" \
  -H "X-Step-Up-Token: <step_up_token>" \
  -F "file=@payouts.csv"
```

---

## Settlement Preview

### Endpoint

```http
GET /v1/settlements/preview
Authorization: Bearer <jwt_token>
```

**Response** (200 OK):
```json
{
  "previews": [
    {
      "currency": "USD",
      "schedule": "weekly",
      "nextSettlementAt": "2026-01-26T00:00:00.000Z",
      "paymentCount": 42,
      "grossAmount": 15234.50,
      "fees": 457.04,
      "pendingRefunds": 0,
      "completedRefunds": 150.00,
      "totalAmount": 14627.46,
      "reserve": 500.00,
      "netAmount": 14127.46
    },
    {
      "currency": "EUR",
      "schedule": "monthly",
      "nextSettlementAt": "2026-02-01T00:00:00.000Z",
      "paymentCount": 8,
      "grossAmount": 5200.00,
      "fees": 156.00,
      "pendingRefunds": 200.00,
      "completedRefunds": 0,
      "totalAmount": 4844.00,
      "reserve": 0,
      "netAmount": 4844.00
    }
  ]
}
```

### Field Descriptions

| Field | Description |
|-------|-------------|
| `currency` | ISO 4217 currency code |
| `schedule` | Settlement frequency (daily, weekly, monthly) |
| `nextSettlementAt` | Scheduled time for next settlement (UTC) |
| `paymentCount` | Number of completed, unsettled payments |
| `grossAmount` | Total of all payment amounts before fees |
| `fees` | Total platform fees deducted |
| `pendingRefunds` | Refunds not yet processed |
| `completedRefunds` | Refunds already processed |
| `totalAmount` | Gross - fees - completed refunds |
| `reserve` | Holdback reserve (if applicable) |
| `netAmount` | Amount available for settlement |

### How It Works

The preview uses the **same calculation** as the actual settlement run:
- Counts completed payments since last settlement
- Deducts all platform fees
- Accounts for pending approval refunds (adds holdback)
- Deducts fully processed refunds
- Applies any reserve requirements

**Note**: Data changes before the scheduled settlement time can change the estimate.

### Schedule Boundaries

Boundaries are calculated in **UTC**:
- **Daily**: Midnight (00:00 UTC)
- **Weekly**: Sunday midnight (00:00 UTC)
- **Monthly**: 1st day of month at midnight (00:00 UTC)

---

## Daily Balance History

### Endpoint

```http
GET /v1/merchants/me/balance/history?from=2026-01-15&to=2026-01-31
Authorization: Bearer <jwt_token>
```

**Query Parameters**:
- `from` (string, required): Start date (ISO 8601 calendar date, e.g., `2026-01-15`)
- `to` (string, required): End date (inclusive, ISO 8601 calendar date)

**Constraints**:
- Date range must span at most 366 days
- Both dates must be valid calendar dates

**Response** (200 OK):
```json
{
  "merchantId": "merchant-uuid",
  "timezone": "America/New_York",
  "days": [
    {
      "date": "2026-01-15",
      "currency": "USD",
      "balance": "12450.75"
    },
    {
      "date": "2026-01-15",
      "currency": "EUR",
      "balance": "3200.00"
    },
    {
      "date": "2026-01-16",
      "currency": "USD",
      "balance": "12120.50"
    },
    {
      "date": "2026-01-16",
      "currency": "EUR",
      "balance": "3200.00"
    }
  ]
}
```

### Field Descriptions

| Field | Description |
|-------|-------------|
| `merchantId` | Merchant identifier |
| `timezone` | Merchant's configured timezone (UTC if not set) |
| `days` | Array of daily balance records |
| `date` | Calendar date (local merchant timezone) |
| `currency` | ISO 4217 currency code |
| `balance` | Available balance (decimal string) |

### How It Works

1. **AVAILABLE Account**: Only returns balances from the AVAILABLE ledger account
2. **Closing Balances**: Each record shows the closing balance for that day
3. **Carry Forward**: Closing balances carry across empty days
4. **Cutoff**: Excludes entries exactly at the following local midnight
5. **Timezone**: Boundaries are calculated in merchant's configured timezone
6. **Daylight Saving**: Handles DST transitions correctly

### Caching

Results are cached for up to 60 seconds. Repeated requests within the window return cached data.

### Example

```bash
curl 'https://api.facilpay.com/v1/merchants/me/balance/history?from=2026-01-15&to=2026-01-31' \
  -H "Authorization: Bearer <jwt_token>"
```

---

## Migration and Testing

### Database Migration

Apply migration `1792368000000-AddPayoutCancellationAndBatch` before using payout cancellation or bulk upload features.

**What it adds**:
- `batch_id` column for batch tracking
- `CANCELLED` status for payouts

**Rollback behavior**: The migration retains the cancellation enum value for existing records if rolled back.

### Testing

Focused specs cover:
- CSV validation (format, escaping, quoting)
- Payout cancellation (pending vs. non-pending states)
- Batch limits (1,000 rows, 1 MiB file size)
- Preview/run agreement (preview matches actual settlement)
- Balance history validation (date ranges, timezones)
- Cache isolation (per-merchant, time-based)

**PostgreSQL History Tests**: Additional specs check DST (daylight-saving time) boundaries:
- Spring forward (autumn → spring transition)
- Fall back (spring → autumn transition)

To enable PostgreSQL-specific tests, set `TEST_DATABASE_URL` to a test database.

---

## Best Practices

1. **Bulk Uploads**: Use for more than 3 payouts to save API calls
2. **Validation**: Review CSV before upload; all rows are validated before save
3. **References**: Keep references unique and descriptive for tracking
4. **Cancellation**: Cancel pending payouts before they're submitted
5. **Preview**: Check settlement preview before settlement runs
6. **Timezone**: Verify balance history timezone matches your location
7. **Batch Tracking**: Store `batchId` for future reference of uploaded payouts

---

## Troubleshooting

### Bulk Upload Fails with Validation Error

**Issue**: CSV validation fails even though format looks correct.

**Causes & Solutions**:
1. **Duplicate references**: References must be unique within batch and globally
   - Check references don't exist in other payouts
   - Ensure no duplicate rows in CSV

2. **Invalid currency**: Currency code not recognized
   - Verify currency is ISO 4217 code or supported crypto
   - Check for typos and spacing

3. **Amount format**: Amount not in decimal format
   - Use format like `1500.50`, not `$1,500.50`
   - Maximum 2 decimal places

4. **Insufficient balance**: Combined payout amount exceeds available balance
   - Check available balance via settlement preview
   - Reduce payout amounts or split into multiple uploads

### Payout Cannot Be Cancelled

**Issue**: Receiving 409 error when trying to cancel payout.

**Causes & Solutions**:
1. **Payout already submitted**: Only pending payouts can be cancelled
   - Check payout status (must be PENDING)
   - Wait for completion or contact support if stuck

2. **Payout already completed**: Cannot cancel finished payouts
   - Once completed, payout cannot be reversed (contact support for refund)

3. **Payout already cancelled**: Repeating cancellation is safe but status is unchanged
   - Check if payout is already cancelled

### Settlement Preview Differs from Actual Settlement

**Issue**: Preview amounts don't match actual settlement.

**Causes & Solutions**:
1. **Data changed**: Payments, refunds, or reserves changed between preview and settlement
   - Preview is a snapshot; take preview again for current estimate
   - Note the `nextSettlementAt` time to account for timing

2. **Pending refunds**: Preview includes pending refund holdbacks
   - Pending refunds may complete before settlement
   - Actual settlement reflects final refund status

### Balance History Shows Zero or Missing Data

**Issue**: Balance history not returning expected data.

**Causes & Solutions**:
1. **Date range invalid**: Dates must span valid range
   - Maximum 366 days
   - Both dates must be valid calendar dates

2. **Timezone issue**: Balances calculated in merchant timezone
   - Verify merchant timezone setting
   - Dates use local timezone boundaries, not UTC

3. **No transactions**: No AVAILABLE ledger entries for that period
   - Balance may be zero if no activity
   - Check merchant account has been funded

---

## FAQ

**Q: What's the maximum file size for bulk payout uploads?**
A: 1 MiB per file, with maximum 1,000 data rows.

**Q: Can I cancel a payout after it's submitted?**
A: No, only pending payouts can be cancelled. Once submitted, contact support.

**Q: Does the settlement preview include reserves?**
A: Yes, the `netAmount` already accounts for any reserve requirements.

**Q: What timezone is used for schedule boundaries?**
A: UTC for settlements. Balance history uses merchant's configured timezone.

**Q: Can I update a payout reference?**
A: No, references are immutable after creation. Create a new payout if needed.

**Q: How often is balance history cached?**
A: Results cache for up to 60 seconds. Repeated requests within the window return cached data.

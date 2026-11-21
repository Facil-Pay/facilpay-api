# Settlements & Payout Scheduling

## Overview

The settlements module lets merchants configure a payout schedule and view settlement history. FacilPay automatically batches completed payments into settlement records on a configurable frequency (daily, weekly, or monthly). Each settlement groups payments by merchant and currency, records the total amount, and links back to the individual payment IDs included in the batch.

Settlement processing is driven by cron jobs that run in the background. Merchants can also be triggered manually by an administrator for ad-hoc settlement runs.

## Configuration

### Schedule Frequencies

| Schedule  | Cron Expression      | Runs                         |
| --------- | -------------------- | ---------------------------- |
| `daily`   | `0 0 * * *`          | Every day at midnight (UTC)  |
| `weekly`  | `0 0 * * 0`          | Every Sunday at midnight     |
| `monthly` | `0 0 1 * *`          | 1st of every month at midnight|

### Gross vs. Net Amounts

By default, settlements are calculated on the **net amount** (payment amount minus platform fees). To settle on the **gross amount** (the full payment amount before fees), set the `SETTLEMENT_USE_GROSS_AMOUNT` environment variable to `true`:

```
SETTLEMENT_USE_GROSS_AMOUNT=true
```

When calculating the settlement total, each completed payment's settled amount is:

- **Gross mode** (`SETTLEMENT_USE_GROSS_AMOUNT=true`): `payment.amount`
- **Net mode** (default): `payment.netAmount` (falls back to `payment.amount` if `netAmount` is not set)

## Endpoints

All settlement endpoints require a valid JWT in the `Authorization` header:

```http
Authorization: Bearer <your_jwt_token>
```

### Download a Settlement Statement

```http
GET /v1/settlements/:id/statement?format=pdf|csv
```

Downloads a reconciliation statement for one settlement. The statement header includes the merchant, settlement period, currency, and transaction hash when available. Its rows include payment ID, external reference, gross amount, fee, net amount, refunds, and settlement adjustments, followed by totals.

The settlement owner or an administrator may download the statement. CSV values are escaped and protected against spreadsheet formula injection.

### Configure Settlement Schedule

```
POST /v1/settlements/config
```

Creates or updates the calling merchant's settlement schedule. Each merchant can have one active configuration.

**Request Body**

```json
{
  "schedule": "weekly",
  "currency": "USD"
}
```

| Field      | Type     | Required | Description                                                   |
| ---------- | -------- | -------- | ------------------------------------------------------------- |
| `schedule` | `string` | Yes      | Payout frequency: `daily`, `weekly`, or `monthly`             |
| `currency` | `string` | Yes      | ISO 4217 currency code for settlements (e.g. `USD`, `EUR`)   |

**Response — `200 OK`**

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "userId": "merchant-uuid",
  "schedule": "weekly",
  "currency": "USD",
  "lastSettledAt": "2026-07-21T00:00:00.000Z",
  "createdAt": "2026-06-01T10:00:00.000Z",
  "updatedAt": "2026-07-14T00:00:00.000Z"
}
```

**Error Responses**

| Status | Condition                        |
| ------ | -------------------------------- |
| `401`  | Missing or invalid JWT           |
| `400`  | Invalid schedule or currency     |

---

### List Merchant Settlements

```
GET /v1/settlements
```

Returns paginated settlements for the authenticated merchant, ordered by `processedAt` descending. Supports optional date range filtering.

**Query Parameters**

| Parameter | Type     | Required | Description                                    |
| --------- | -------- | -------- | ---------------------------------------------- |
| `from`    | `string` | No       | Start date filter (ISO 8601), filters by `processedAt >= from` |
| `to`      | `string` | No       | End date filter (ISO 8601), filters by `processedAt <= to`     |
| `page`    | `number` | No       | Page number (default: `1`)                     |
| `limit`   | `number` | No       | Items per page (default: `20`, max: `100`)     |

**Response — `200 OK`**

```json
{
  "data": [
    {
      "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      "merchantId": "merchant-uuid",
      "schedule": "weekly",
      "totalAmount": 1523.75,
      "currency": "USD",
      "paymentIds": ["pay-1", "pay-2", "pay-3"],
      "processedAt": "2026-07-21T00:00:00.000Z",
      "createdAt": "2026-07-21T00:00:01.000Z",
      "updatedAt": "2026-07-21T00:00:01.000Z"
    }
  ],
  "total": 12,
  "page": 1,
  "limit": 20
}
```

**Error Responses**

| Status | Condition                  |
| ------ | -------------------------- |
| `401`  | Missing or invalid JWT     |

---

### List Settlement Adjustments

```
GET /v1/settlements/:id/adjustments
```

Returns post-settlement refund adjustments for a specific settlement. An adjustment is created whenever a payment that was already included in a settlement is later refunded.

**Path Parameters**

| Parameter | Type     | Description      |
| --------- | -------- | ---------------- |
| `id`      | `string` | Settlement UUID  |

**Response — `200 OK`**

```json
[
  {
    "id": "adj-uuid-1",
    "settlementId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "refundId": "refund-uuid-1",
    "paymentId": "pay-1",
    "merchantId": "merchant-uuid",
    "amount": -50.00,
    "currency": "USD",
    "createdAt": "2026-07-25T14:30:00.000Z"
  }
]
```

> **Note:** Adjustment amounts are negative — they represent deductions from the original settlement total.

**Error Responses**

| Status | Condition                           |
| ------ | ----------------------------------- |
| `401`  | Missing or invalid JWT              |
| `404`  | Settlement not found or not owned   |

---

## Admin Endpoints

The following endpoints are restricted to users with the `ADMIN` role.

### List All Settlements (Admin)

```
GET /v1/admin/settlements
```

Returns paginated settlements across **all** merchants. Supports the same date range and pagination parameters as the merchant endpoint.

**Query Parameters**

| Parameter | Type     | Required | Description                                    |
| --------- | -------- | -------- | ---------------------------------------------- |
| `from`    | `string` | No       | Start date filter (ISO 8601)                   |
| `to`      | `string` | No       | End date filter (ISO 8601)                     |
| `page`    | `number` | No       | Page number (default: `1`)                     |
| `limit`   | `number` | No       | Items per page (default: `20`, max: `100`)     |

**Response — `200 OK`**

```json
{
  "data": [
    {
      "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      "merchantId": "merchant-uuid",
      "schedule": "monthly",
      "totalAmount": 5420.50,
      "currency": "USD",
      "paymentIds": ["pay-1", "pay-2", ...],
      "processedAt": "2026-07-01T00:00:00.000Z",
      "createdAt": "2026-07-01T00:00:01.000Z",
      "updatedAt": "2026-07-01T00:00:01.000Z"
    }
  ],
  "total": 84,
  "page": 1,
  "limit": 20
}
```

**Error Responses**

| Status | Condition                  |
| ------ | -------------------------- |
| `401`  | Missing or invalid JWT     |
| `403`  | Admin role required        |

---

### Manually Trigger Settlement Run (Admin)

```
POST /v1/admin/settlements/run
```

Triggers an out-of-band settlement run for **all** merchants with a configured settlement schedule, independent of the regular cron schedule. This processes every merchant that has pending completed payments since their last settlement.

**Response — `200 OK`**

```json
{
  "settlementsCreated": 2,
  "totalAmount": 3147.25,
  "settlements": [
    {
      "id": "new-settlement-1",
      "merchantId": "merchant-uuid-1",
      "schedule": "weekly",
      "totalAmount": 1523.75,
      "currency": "USD",
      "paymentIds": ["pay-1", "pay-2"],
      "processedAt": "2026-07-21T12:00:00.000Z"
    },
    {
      "id": "new-settlement-2",
      "merchantId": "merchant-uuid-2",
      "schedule": "monthly",
      "totalAmount": 1623.50,
      "currency": "EUR",
      "paymentIds": ["pay-3"],
      "processedAt": "2026-07-21T12:00:00.000Z"
    }
  ]
}
```

> **Note:** Merchants with no pending completed payments since their last settlement are skipped — no empty settlements are created.

**Error Responses**

| Status | Condition                  |
| ------ | -------------------------- |
| `401`  | Missing or invalid JWT     |
| `403`  | Admin role required        |

---

## How Settlement Processing Works

### Selection Criteria

When a settlement runs (either by cron or manual trigger), the system:

1. Finds all merchant settlement configs matching the triggered schedule.
2. For each config, queries for payments where:
   - `status = COMPLETED`
   - `merchantId` matches the config owner
   - `currency` matches the config currency
   - `updatedAt > lastSettledAt` (or all completed payments if `lastSettledAt` is null)
3. If no matching payments exist, the merchant is skipped for this run.

### Settlement Creation

For each merchant with pending payments:

1. Sums the payment amounts (gross or net, based on `SETTLEMENT_USE_GROSS_AMOUNT`).
2. Creates a `Settlement` record with the total amount, currency, and linked payment IDs.
3. Updates all included payments with the `settlementId` reference.
4. Updates `lastSettledAt` on the merchant's config to the current timestamp.
5. Sends a settlement notification email to the merchant.

### Refund Adjustments

When a payment that has already been settled is later refunded, a `SettlementAdjustment` record is created on the original settlement. The adjustment stores the refund amount as a negative value, allowing the merchant to reconcile post-settlement refunds against their settlement history.

### Cron Schedules

The following cron jobs run automatically:

| Schedule  | Cron Expression | Method                     |
| --------- | --------------- | -------------------------- |
| Daily     | `0 0 * * *`     | `runDailySettlements()`    |
| Weekly    | `0 0 * * 0`     | `runWeeklySettlements()`   |
| Monthly   | `0 0 1 * *`     | `runMonthlySettlements()`  |

Each cron job processes only merchants whose config matches that schedule frequency. Multiple schedules can overlap — a merchant with a `daily` config will be processed by the daily cron, while a merchant with a `monthly` config is only processed on the 1st of each month.

---

## Authentication & Permissions

| Endpoint                              | Method | Auth Required | Role       |
| ------------------------------------- | ------ | ------------- | ---------- |
| `POST /v1/settlements/config`         | Yes    | Yes           | Any (merchant configures own) |
| `GET /v1/settlements`                 | Yes    | Yes           | Any (returns own settlements) |
| `GET /v1/settlements/:id/adjustments` | Yes    | Yes           | Any (returns own adjustments) |
| `GET /v1/admin/settlements`           | Yes    | Yes           | **ADMIN**  |
| `POST /v1/admin/settlements/run`      | Yes    | Yes           | **ADMIN**  |

Ownership is enforced at the service layer — merchants can only access their own settlement data. The admin endpoints bypass merchant filtering and require the `ADMIN` role.

---

## Usage Examples

### Example 1: Configure Weekly Settlement Schedule

```bash
curl -X POST https://api.facilpay.com/v1/settlements/config \
  -H "Authorization: Bearer <jwt_token>" \
  -H "Content-Type: application/json" \
  -d '{
    "schedule": "weekly",
    "currency": "USD"
  }'
```

Response:
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "userId": "merchant-uuid",
  "schedule": "weekly",
  "currency": "USD",
  "lastSettledAt": null,
  "createdAt": "2026-07-14T10:00:00.000Z",
  "updatedAt": "2026-07-14T10:00:00.000Z"
}
```

---

### Example 2: View Settlement History

```bash
curl https://api.facilpay.com/v1/settlements \
  -H "Authorization: Bearer <jwt_token>"
```

---

### Example 3: Download Settlement Statement (PDF)

```bash
curl https://api.facilpay.com/v1/settlements/a1b2c3d4-e5f6-7890-abcd-ef1234567890/statement?format=pdf \
  -H "Authorization: Bearer <jwt_token>" \
  -o settlement_statement.pdf
```

---

### Example 4: Download Settlement Statement (CSV)

```bash
curl https://api.facilpay.com/v1/settlements/a1b2c3d4-e5f6-7890-abcd-ef1234567890/statement?format=csv \
  -H "Authorization: Bearer <jwt_token>" \
  -o settlement_statement.csv
```

---

### Example 5: Filter Settlements by Date Range

```bash
curl 'https://api.facilpay.com/v1/settlements?from=2026-07-01&to=2026-07-31&limit=50' \
  -H "Authorization: Bearer <jwt_token>"
```

---

### Example 6: View Settlement Adjustments

```bash
curl https://api.facilpay.com/v1/settlements/a1b2c3d4-e5f6-7890-abcd-ef1234567890/adjustments \
  -H "Authorization: Bearer <jwt_token>"
```

---

### Example 7: Admin - Trigger Manual Settlement Run

```bash
curl -X POST https://api.facilpay.com/v1/admin/settlements/run \
  -H "Authorization: Bearer <admin_jwt_token>"
```

---

## Reconciliation Guide

### Settlement Statement Format

The settlement statement CSV includes the following columns:

| Column | Description |
|--------|-------------|
| `Payment ID` | Unique payment identifier |
| `External Reference` | External payment reference (if provided) |
| `Gross Amount` | Full payment amount before fees |
| `Fee` | Platform fee deducted |
| `Net Amount` | Amount settled (gross - fee) |
| `Refunds` | Total refunds applied |
| `Adjustments` | Post-settlement adjustments |

**Footer includes:**
- Total gross amount
- Total fees
- Total net amount settled
- Any adjustments

### Reconciliation Process

1. **Obtain settlement statement**: Download CSV or PDF from settlement endpoint
2. **Match payments**: Cross-reference payment IDs with your accounting system
3. **Verify amounts**: Confirm gross, fee, and net amounts match
4. **Account for refunds**: Subtract any refunds from settlement total
5. **Check adjustments**: Review any post-settlement refund adjustments

---

## Troubleshooting

### Settlement Not Processing

**Issue**: Expected settlement did not process at scheduled time.

**Causes & Solutions**:

1. **No pending payments**: Settlement only runs if there are completed payments since last settlement
   - Check if you have any completed payments in that period
   - Use the payments API to verify payment status

2. **Settlement schedule not configured**: Settlement requires active configuration
   - Call `POST /v1/settlements/config` to set up schedule
   - Verify response includes `schedule` and `currency`

3. **Scheduled time hasn't passed**: Cron jobs run at specific UTC times
   - Daily: 00:00 UTC
   - Weekly: 00:00 UTC on Sundays
   - Monthly: 00:00 UTC on the 1st
   - Wait until the scheduled time or request manual settlement

4. **Different currency configured**: Settlement only processes payments in configured currency
   - Check settlement config currency matches payment currency
   - Create separate settlement configs for each currency

### Settlement Amount Mismatch

**Issue**: Settlement total doesn't match expected amount.

**Causes & Solutions**:

1. **Gross vs. Net mode**: Verify which mode is active
   - Check `SETTLEMENT_USE_GROSS_AMOUNT` environment variable
   - Gross mode: settlement = sum of all payment amounts
   - Net mode: settlement = sum of all net amounts (after fees)

2. **Refunds not included**: Refunds issued before settlement are deducted from net amount
   - Check individual payment refund amounts
   - Verify payment net amount calculation

3. **Post-settlement refunds**: Refunds after settlement show as adjustments
   - Check `GET /v1/settlements/:id/adjustments` endpoint
   - Adjustments have negative amounts

### Cannot Download Statement

**Issue**: Statement download fails or returns error.

**Causes & Solutions**:

1. **Invalid settlement ID**: Settlement ID must exist and belong to authenticated merchant
   - Verify settlement ID from `GET /v1/settlements` response
   - Ensure you're using correct UUID format

2. **Format not supported**: Only PDF and CSV formats supported
   - Use `?format=pdf` or `?format=csv`
   - Default format may be CSV

3. **Permission denied**: Only settlement owner or admin can download
   - Verify JWT token is for correct merchant
   - Admin users can download any settlement

4. **Settlement too old**: Very old settlements may have archived statements
   - Contact support if statement unavailable
   - Check `processedAt` timestamp

### Missing Adjustments

**Issue**: Refund made after settlement not showing as adjustment.

**Causes & Solutions**:

1. **Timing**: Adjustment created when refund is finalized
   - Verify refund status is not pending
   - Wait for refund processing to complete

2. **Payment not in settlement**: Only payments already in settlement create adjustments
   - Check payment `settlementId` field
   - Verify payment was completed before settlement ran

3. **Settlement not yet processed**: Adjustments only apply to already-processed settlements
   - Verify settlement `processedAt` is in the past
   - Check settlement was not pending

---

## Best Practices

1. **Configure early**: Set up settlement schedule immediately after account creation
2. **Monitor regularly**: Review settlement statements monthly for reconciliation
3. **Archive statements**: Keep copies of settlement statements for audit purposes
4. **Track adjustments**: Monitor post-settlement refund adjustments closely
5. **Multi-currency**: Set up separate configs for each currency you accept
6. **Test in sandbox**: Verify settlement settings before using in production

---

## FAQ

**Q: Can I change my settlement frequency?**
A: Yes, call `POST /v1/settlements/config` with the new frequency. It takes effect immediately for next run.

**Q: Can I settle in multiple currencies?**
A: Yes, create a separate settlement config for each currency.

**Q: Are settlements in gross or net amount?**
A: By default, settlements are in net amount (after fees). Set `SETTLEMENT_USE_GROSS_AMOUNT=true` for gross settlements.

**Q: What happens if I'm refunded after settlement?**
A: A negative adjustment is created on the settlement record to track the post-settlement refund.

**Q: Can I manually trigger a settlement?**
A: Yes, admins can call `POST /v1/admin/settlements/run` to trigger manual runs.

**Q: How do I reconcile settlements with my bank?**
A: Use the settlement statement CSV and compare transaction amounts and counts with your bank statement.

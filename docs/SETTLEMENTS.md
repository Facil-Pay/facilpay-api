# Settlements & Payout Scheduling

## Overview

The settlements module lets merchants configure a payout schedule and view settlement history. FacilPay automatically batches completed payments into settlement records on a configurable frequency (daily, weekly, or monthly). Each settlement groups payments by merchant and currency, records the total amount, and links back to the individual payment IDs included in the batch.

Merchants can also choose a **preferred Stellar settlement asset** (`settlementAsset`). Balances received in a different asset are converted to it at settlement time with a Stellar path payment, subject to a configurable maximum slippage.

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

When a conversion took place, the header also reports `settlementAsset`, `sourceAsset`, `sourceAmount`, `destAmount`, `conversionRate`, `slippagePercent`, `conversionFee` (in XLM) and `conversionTransactionHash`. The PDF statement includes the same conversion details under an "Asset conversion" section.

The settlement owner or an administrator may download the statement. CSV values are escaped and protected against spreadsheet formula injection.

### Configure Settlement Schedule

```
POST /v1/settlements/config
```

Creates or updates the calling merchant's settlement schedule. Each merchant can have one active configuration per currency.

**Request Body**

```json
{
  "schedule": "weekly",
  "currency": "USD",
  "settlementAsset": "USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
  "maxSlippagePercent": 0.5
}
```

| Field                 | Type     | Required | Description                                                                       |
| --------------------- | -------- | -------- | --------------------------------------------------------------------------------- |
| `schedule`            | `string` | Yes      | Payout frequency: `daily`, `weekly`, or `monthly`                                 |
| `currency`            | `string` | Yes      | ISO 4217 currency code for settlements (e.g. `USD`, `EUR`)                       |
| `settlementAsset`     | `string` | No       | Preferred Stellar asset: `XLM` or `CODE:ISSUER`. Omit to keep the legacy behaviour |
| `maxSlippagePercent`  | `number` | No       | Maximum tolerated conversion slippage in percent, 0–100 (default `0.5`)          |

The payout destination's `assetCode` must match the settlement asset code. A payment's source Stellar asset is read from its `metadata.assetCode` / `metadata.assetIssuer`; when the issuer is missing it is resolved from the platform's accepted Stellar assets.

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

| Status | Condition                                             |
| ------ | ----------------------------------------------------- |
| `401`  | Missing or invalid JWT                                |
| `400`  | Invalid schedule, currency, settlement asset or destination |

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
2. If a `settlementAsset` is configured, groups payments by their source Stellar asset, quotes a strict-send path for each non-matching group and sends the converted funds to the merchant's payout destination. The on-chain `destMin` enforces `maxSlippagePercent`; an excessive quote or executed slippage aborts the run and creates a `FAILED` settlement with a `failureReason`.
3. Creates a `Settlement` record with the total amount, currency, linked payment IDs and (when applicable) the conversion rate, slippage, fee and transaction hash.
4. Updates all included payments with the `settlementId` reference.
5. Updates `lastSettledAt` on the merchant's config to the current timestamp.
6. Sends settlement events/webhooks (including the conversion details) and a notification email to the merchant.

A conversion that still requires multi-sig signatures leaves the settlement in `pending` state; it becomes visible as completed only after the transaction is signed and submitted.

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
| `GET /v1/settlements/:id/statement`   | Yes    | Yes           | Any (owner or **ADMIN**)      |
| `GET /v1/settlements/:id/adjustments` | Yes    | Yes           | Any (returns own adjustments) |
| `GET /v1/admin/settlements`           | Yes    | Yes           | **ADMIN**  |
| `POST /v1/admin/settlements/run`      | Yes    | Yes           | **ADMIN**  |

Ownership is enforced at the service layer — merchants can only access their own settlement data. The admin endpoints bypass merchant filtering and require the `ADMIN` role.

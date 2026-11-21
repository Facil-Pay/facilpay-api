# Unmatched Transactions

## Overview

When a Stellar payment arrives at the merchant account with a missing or incorrect memo, the system cannot automatically link it to a pending payment. Rather than silently dropping these funds, the Horizon stream service stores them as **unmatched transactions** and emits a `transaction.unmatched` event so merchants are notified.

Merchants can then inspect these records and either:

- **Match** the transaction to the correct pending payment (completing it), or
- **Mark it as refunded** (the on-chain refund must be executed separately via Stellar tooling).

---

## Endpoints

All endpoints require a valid JWT (`Authorization: Bearer <token>`).

### List Unmatched Transactions

```
GET /v1/unmatched-transactions
```

Returns a paginated list of unmatched on-chain transactions.

**Query Parameters**

| Parameter | Type   | Required | Description                                        |
|-----------|--------|----------|----------------------------------------------------|
| `status`  | string | No       | Filter by status: `PENDING`, `MATCHED`, `REFUNDED` |
| `limit`   | number | No       | Page size (default: 20, max: 100)                  |
| `offset`  | number | No       | Number of records to skip (default: 0)             |

**Response — `200 OK`**

```json
{
  "data": [
    {
      "id": "123e4567-e89b-12d3-a456-426614174000",
      "transactionHash": "a1b2c3...",
      "fromAddress": "GABCD...",
      "amount": "50.0000000",
      "assetCode": "XLM",
      "memo": null,
      "status": "PENDING",
      "matchedPaymentId": null,
      "resolvedBy": null,
      "resolvedAt": null,
      "createdAt": "2026-01-26T10:00:00.000Z",
      "updatedAt": "2026-01-26T10:00:00.000Z"
    }
  ],
  "total": 1
}
```

---

### Get a Single Unmatched Transaction

```
GET /v1/unmatched-transactions/:id
```

**Path Parameters**

| Parameter | Type   | Description                       |
|-----------|--------|-----------------------------------|
| `id`      | string | Unmatched transaction UUID        |

**Response — `200 OK`** — single `UnmatchedTransaction` object.

**Error Responses**

| Status | Condition               |
|--------|-------------------------|
| `401`  | Missing or invalid JWT  |
| `404`  | Transaction not found   |

---

### Match a Transaction to a Payment

```
POST /v1/unmatched-transactions/:id/match
```

Links the transaction to an existing `PENDING` payment. The payment is atomically moved to `COMPLETED` and a `transaction.matched` event is emitted. A transaction can only be matched **once**.

**Path Parameters**

| Parameter | Type   | Description                       |
|-----------|--------|-----------------------------------|
| `id`      | string | Unmatched transaction UUID        |

**Request Body**

```json
{
  "paymentId": "9f1a2b3c-..."
}
```

| Field       | Type   | Required | Description                             |
|-------------|--------|----------|-----------------------------------------|
| `paymentId` | string | Yes      | UUID of the target `PENDING` payment    |

**Response — `200 OK`** — the updated `UnmatchedTransaction` with `status: "MATCHED"`.

**Error Responses**

| Status | Condition                                          |
|--------|----------------------------------------------------|
| `400`  | Target payment is not in `PENDING` status          |
| `401`  | Missing or invalid JWT                             |
| `404`  | Unmatched transaction or payment not found         |
| `409`  | Transaction has already been matched or refunded   |

---

### Mark a Transaction as Refunded

```
POST /v1/unmatched-transactions/:id/refund
```

Records that the funds were returned to the sender on-chain. The actual Stellar refund transaction must be executed externally (e.g. via Stellar Laboratory or the `/v1/stellar` endpoints).

**Path Parameters**

| Parameter | Type   | Description                       |
|-----------|--------|-----------------------------------|
| `id`      | string | Unmatched transaction UUID        |

**Response — `200 OK`** — the updated `UnmatchedTransaction` with `status: "REFUNDED"`.

**Error Responses**

| Status | Condition                                        |
|--------|--------------------------------------------------|
| `401`  | Missing or invalid JWT                           |
| `404`  | Transaction not found                            |
| `409`  | Transaction has already been matched or refunded |

---

## Events

| Event type              | Emitted when                                              |
|-------------------------|-----------------------------------------------------------|
| `transaction.unmatched` | An incoming payment cannot be matched to any pending payment |
| `transaction.matched`   | A merchant manually links a transaction to a payment       |

Both events are accessible via `GET /v1/events`.

---

## Status Lifecycle

```
PENDING ──► MATCHED   (via POST /match)
        └──► REFUNDED  (via POST /refund)
```

Once a transaction reaches `MATCHED` or `REFUNDED` it is immutable.

---

## Database

The feature is backed by the `unmatched_transactions` table, added in migration `1792800000000-CreateUnmatchedTransactionsTable`. Roll back with:

```bash
npm run migrate:revert
```

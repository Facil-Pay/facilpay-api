# On-Chain Payment Proof Verification

## Overview

Support teams often receive claims like "I paid — here is my transaction hash." This endpoint lets you check that claim programmatically by fetching the transaction from Horizon and comparing every relevant field against the stored payment record.

---

## Endpoint

```
POST /v1/payments/:id/verify-transaction
```

Requires a valid JWT (`Authorization: Bearer <token>`). Rate-limited to **10 requests per minute** per merchant.

### Path Parameters

| Parameter | Type   | Description   |
|-----------|--------|---------------|
| `id`      | string | Payment UUID  |

### Request Body

```json
{
  "transactionHash": "a1b2c3d4...",
  "completeOnMatch": false
}
```

| Field              | Type    | Required | Description |
|--------------------|---------|----------|-------------|
| `transactionHash`  | string  | Yes      | Stellar transaction hash provided by the payer |
| `completeOnMatch`  | boolean | No       | If `true` and all fields match, the payment is moved to `COMPLETED` immediately. Only applies when the payment is still `PENDING`. Default: `false` |

### Response — `200 OK`

```json
{
  "matched": true,
  "mismatches": [],
  "paymentCompleted": false,
  "transactionHash": "a1b2c3d4...",
  "onChain": {
    "destination": "GABCD...",
    "assetCode": "USDC",
    "amount": "100.0000000",
    "memo": "PAY-ref-001",
    "from": "GPAYER...",
    "createdAt": "2026-01-26T10:00:00Z"
  }
}
```

| Field              | Type    | Description |
|--------------------|---------|-------------|
| `matched`          | boolean | `true` when every checked field matches |
| `mismatches`       | array   | List of field-level mismatches (empty when `matched` is `true`) |
| `paymentCompleted` | boolean | `true` when the payment was completed by this call |
| `transactionHash`  | string  | The hash that was checked |
| `onChain`          | object  | Raw values extracted from Horizon |

### Mismatch object

```json
{
  "field": "memo",
  "expected": "PAY-ref-001",
  "actual": "wrong-ref"
}
```

| Field      | Type          | Description |
|------------|---------------|-------------|
| `field`    | string        | One of `destination`, `assetCode`, `amount`, `memo` |
| `expected` | string        | Value stored on the payment record |
| `actual`   | string\|null  | Value found on-chain (null when not present) |

### Error Responses

| Status | Condition |
|--------|-----------|
| `400`  | Transaction not found on Horizon, or hash is otherwise invalid |
| `401`  | Missing or invalid JWT |
| `404`  | Payment not found |
| `429`  | Rate limit exceeded (10 req/min) |
| `422`  | Validation error (e.g. `transactionHash` missing) |

---

## Checked Fields

| Field         | Passes when |
|---------------|-------------|
| `destination` | The first payment operation in the transaction is directed at `STELLAR_MERCHANT_ACCOUNT_ID`. Muxed (`M...`) addresses are resolved to their base `G...` address before comparison. |
| `assetCode`   | The asset code of the payment operation matches `payment.currency` (case-insensitive). |
| `amount`      | The on-chain amount is ≥ `payment.amount` (within a 0.0000001 tolerance). Overpayments are allowed. |
| `memo`        | Only checked when `payment.externalReference` is set. The transaction memo must match exactly. |

---

## Completing a payment on match

Set `completeOnMatch: true` to let support staff close a payment in a single call once they confirm the proof is valid:

```bash
curl -X POST /v1/payments/<id>/verify-transaction \
  -H 'Authorization: Bearer <jwt>' \
  -d '{
    "transactionHash": "a1b2c3...",
    "completeOnMatch": true
  }'
```

If the payment is already in a terminal state (e.g. already `COMPLETED`), `completeOnMatch` is silently ignored — no error is returned.

---

## Audit Log

Every call is recorded in `payment_verification_logs` regardless of the outcome, capturing:

- `paymentId`
- `transactionHash`
- `matched` (boolean)
- `mismatches` (JSONB array)
- `paymentCompleted` (boolean)
- `requestedBy` (actor ID from the JWT)
- `createdAt`

The table is added by migration `1793000000000-CreatePaymentVerificationLogsTable` and is reversible:

```bash
npm run migrate:revert
```

---

## Rate Limiting

The endpoint uses the `verify` throttle tier: **10 requests per minute** per merchant. Exceeding this returns `429 Too Many Requests`.

---

## Example: mismatched memo

```json
{
  "matched": false,
  "mismatches": [
    {
      "field": "memo",
      "expected": "PAY-ref-001",
      "actual": "pay-ref-001"
    }
  ],
  "paymentCompleted": false,
  "transactionHash": "a1b2c3...",
  "onChain": {
    "destination": "GABCD...",
    "assetCode": "USDC",
    "amount": "100.0000000",
    "memo": "pay-ref-001",
    "from": "GPAYER...",
    "createdAt": "2026-01-26T10:00:00Z"
  }
}
```

Memo matching is case-sensitive and byte-exact.

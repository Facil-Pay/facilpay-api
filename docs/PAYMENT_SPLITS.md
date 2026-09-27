# Payment Splits

## Overview

Payment splits let an integrator distribute one completed FacilPay payment across multiple Stellar recipient addresses.

Splits are supplied when the payment is created through `POST /v1/payments`. Each split stores a recipient, percentage, calculated amount, processing status, Stellar transaction hash, and (when applicable) a failure reason.

The current implementation is defined by:

- `src/modules/payments/dto/create-payment.dto.ts`
- `src/modules/payments/dto/create-payment-split.dto.ts`
- `src/modules/payments/payment-split.entity.ts`
- `src/modules/payments/payments.service.ts`

## Creating a payment with splits

Add an optional `splits` array to the normal payment creation request.

```http
POST /v1/payments
Authorization: Bearer <jwt>
Content-Type: application/json
```

Example:

```json
{
  "amount": 100,
  "currency": "USD",
  "merchantId": "abc123-merchant-uuid",
  "description": "Order #1001",
  "splits": [
    {
      "recipientAddress": "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
      "percentage": 50
    },
    {
      "recipientAddress": "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBXYZ",
      "percentage": 30
    },
    {
      "recipientAddress": "GCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCPQR",
      "percentage": 20
    }
  ]
}
```

The `splits` field is optional. When it is present, the current DTO rules require:

| Rule | Current validation |
| --- | --- |
| Number of recipients | At least 1 |
| `recipientAddress` | Non-empty string |
| `percentage` | Number from `0.01` through `100` |
| Total percentage | Must be within `0.01` of `100` |

The percentage-sum validator currently accepts totals where `Math.abs(total - 100) < 0.01`. Invalid requests fail DTO validation before split rows are created.

> **Address validation:** `CreatePaymentSplitDto` currently checks that `recipientAddress` is a non-empty string. It does not itself perform Stellar-address format validation.

## How split amounts are calculated

When the payment is created, FacilPay creates one `PaymentSplit` row per requested recipient.

For each split, the stored amount is calculated as:

```text
round_to_2_decimals(payment.amount * percentage / 100)
```

The implementation uses JavaScript `toFixed(2)`, so each split is rounded independently to two decimal places before it is saved.

Because each leg is rounded separately, fractional-cent allocations can produce a small rounding difference between the sum of the stored split amounts and the original payment amount. Integrators should not assume that independently rounded split rows will always add back to the source amount for every percentage combination.

## Fees and the split basis

Merchant fees are calculated separately during payment creation and stored as `feeAmount` and `netAmount`.

At the time of writing, split amounts are calculated from the gross `payment.amount`, not from `netAmount`. The fee is therefore **not deducted from the amount used to calculate each split**.

For example, consider a `100.00` payment with a configured `2.50` merchant fee:

| Value | Amount |
| --- | ---: |
| Gross payment amount | 100.00 |
| Merchant fee | 2.50 |
| Stored net amount | 97.50 |

With splits of 50%, 30%, and 20%, the current implementation stores:

| Recipient | Percentage | Split amount |
| --- | ---: | ---: |
| Recipient A | 50% | 50.00 |
| Recipient B | 30% | 30.00 |
| Recipient C | 20% | 20.00 |
| **Total** | **100%** | **100.00** |

This example is intentionally based on the current code path. If the product is changed so that split distribution is based on the post-fee `netAmount`, the calculation and this documentation must be updated together.

## When splits are processed

Split rows are initially created with status `PENDING`.

When a payment reaches `COMPLETED`, `PaymentsService.processSplitsForPayment` loads that payment's pending split rows and submits each one as a separate Stellar payment.

Each leg is processed independently:

1. FacilPay calls the Stellar payment service for the split recipient and stored amount.
2. A successful transfer changes the split to `COMPLETED` and stores the Stellar transaction hash.
3. A failed transfer changes the split to `FAILED` and stores the failure reason.
4. Processing continues with the remaining split rows even when one leg fails.

If one or more split transfers fail, the parent payment is changed to `PARTIALLY_COMPLETED`. If all pending splits succeed, the parent payment remains `COMPLETED`.

## Split statuses

`PaymentSplitStatus` currently has three values:

| Status | Meaning |
| --- | --- |
| `PENDING` | The split has been created but has not completed its Stellar transfer. |
| `COMPLETED` | The Stellar transfer succeeded. `stellarTransactionHash` contains the resulting transaction hash when one was returned. |
| `FAILED` | The Stellar transfer threw an error. `failureReason` contains the recorded error message. |

## Failed splits and retries

A failed leg is persisted as `FAILED`, including its `failureReason`.

The repository has a historical feature request for a dedicated retry route:

```http
POST /v1/payments/:id/splits/:splitId/retry
```

However, on the current `main` branch, `PaymentsController` and `PaymentsService` do **not** expose that retry endpoint or a public service method that retries a specific `FAILED` split.

Accordingly, integrators should not currently assume that failed split legs are retried automatically or that the route above is available. A `FAILED` row remains failed until it is remediated by implementation/operational work outside the currently exposed API.

When a retry API is added, it should preserve the intended safety rules described by the payment-split model: only failed legs should be retried, already completed legs must not be paid twice, and the parent payment status should be re-evaluated after all legs succeed.

## `payment.split_processed` webhook

After the pending split batch has been processed, FacilPay dispatches a `payment.split_processed` webhook for payments that have a `merchantId`.

Example payload:

```json
{
  "event": "payment.split_processed",
  "timestamp": "2026-09-27T10:00:00.000Z",
  "data": {
    "paymentId": "123e4567-e89b-12d3-a456-426614174000",
    "totalSplits": 3,
    "failedSplits": 1,
    "status": "PARTIALLY_COMPLETED"
  }
}
```

The event-specific `data` fields are:

| Field | Meaning |
| --- | --- |
| `paymentId` | Parent payment ID |
| `totalSplits` | Number of pending split rows processed in that batch |
| `failedSplits` | Number of those split transfers that failed |
| `status` | Parent payment status after split processing |

Webhook delivery, signatures, endpoint subscriptions, and delivery retries are documented separately in [WEBHOOKS.md](./WEBHOOKS.md).

## Refund interaction

Refunds are initiated through:

```http
POST /v1/payments/:id/refund
```

The refund flow updates the parent payment's `refundedAmount`, creates a refund record, and moves the parent payment to `PARTIALLY_REFUNDED` or `REFUNDED` as appropriate.

Stellar split transfers that have already completed are separate on-chain payments. They cannot be implicitly undone by changing the parent payment record.

On the current `main` branch, the refund implementation does not inspect `PaymentSplit` rows before processing a refund and does not automatically claw back, reverse, or proportionally reconcile already-completed split transfers.

That means an integrator handling a refund after split execution must account for the already-distributed funds operationally. A refund of the parent payment should not be interpreted as proof that completed split recipients returned their funds.

For the general refund API, validation, statuses, and webhook behavior, see [REFUNDS.md](./REFUNDS.md).

## Worked three-recipient example

Assume the following request:

```json
{
  "amount": 100,
  "currency": "USD",
  "merchantId": "abc123-merchant-uuid",
  "splits": [
    {
      "recipientAddress": "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
      "percentage": 33.33
    },
    {
      "recipientAddress": "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBXYZ",
      "percentage": 33.33
    },
    {
      "recipientAddress": "GCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCPQR",
      "percentage": 33.34
    }
  ]
}
```

The percentages sum to 100 and each individual percentage is within the DTO's allowed range.

Using the current split formula:

```text
Recipient A: (100.00 * 33.33 / 100).toFixed(2) = 33.33
Recipient B: (100.00 * 33.33 / 100).toFixed(2) = 33.33
Recipient C: (100.00 * 33.34 / 100).toFixed(2) = 33.34
```

The three stored split amounts are therefore `33.33`, `33.33`, and `33.34`.

If a merchant fee is also configured, the payment may have a lower `netAmount`, but these split amounts still use the gross `100.00` payment amount under the current implementation.

Once the parent payment completes, each split is submitted separately to Stellar. For example, if A and C succeed while B fails:

- A becomes `COMPLETED` and stores its Stellar transaction hash.
- B becomes `FAILED` and stores its failure reason.
- C becomes `COMPLETED` and stores its Stellar transaction hash.
- The parent payment becomes `PARTIALLY_COMPLETED`.
- `payment.split_processed` is dispatched with `totalSplits: 3` and `failedSplits: 1`.

## Integration checklist

Before creating a split payment:

1. Make sure every recipient entry has a non-empty address string.
2. Keep every percentage between `0.01` and `100`.
3. Make the percentages total 100 within the DTO tolerance.
4. Expect each leg to be rounded independently to two decimal places.
5. Remember that the current split basis is the gross payment amount, not `netAmount`.
6. Subscribe to `payment.split_processed` if the merchant needs asynchronous split results.
7. Treat `FAILED` legs as requiring explicit remediation; the current public API does not expose the historical retry route.
8. Do not assume a parent refund reverses already-completed Stellar split transfers.

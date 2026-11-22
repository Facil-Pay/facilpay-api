# Merchant balance ledger

The merchant ledger is an append-only double-entry record. Each row is one
signed balance delta; rows sharing a `transactionId` must sum to exactly zero
for the transaction's merchant and currency.

## Accounts

- `PENDING` — the payment funding/clearing side of a completion movement.
- `AVAILABLE` — merchant funds available for settlement.
- `FEES` — platform fee captured from a completed payment.
- `PAYOUT` — settlement clearing and refunds before settlement.
- `RESERVE` — post-settlement refund reserve.

Amounts are stored as fixed-scale decimals and are never rewritten. The
application validates each transaction before insert, and the database
migration adds an update/delete trigger to protect the append-only invariant.

## API

Both endpoints require the authenticated merchant's JWT and always scope by
that merchant ID:

- `GET /v1/merchants/me/balance?currency=USD` returns balances grouped by
  currency and account.
- `GET /v1/merchants/me/ledger?page=1&limit=20` returns paginated entries.
  Optional filters are `currency`, `account`, `referenceType`, `from`, and
  `to`.

## CSV export

`GET /v1/merchants/me/ledger?format=csv&from=<iso>&to=<iso>` returns the
merchant's entries for the range as `text/csv` (`Content-Disposition:
attachment; filename="ledger-export.csv"`). Both `from` and `to` are required
and inclusive, `page` and `limit` are ignored, and the `currency`, `account`
and `referenceType` filters still apply. Rows are ordered oldest first.

| Column | Description |
| --- | --- |
| `id` | Ledger entry ID |
| `createdAt` | ISO 8601 timestamp (UTC) |
| `currency` | Three-letter currency code |
| `account` | `AVAILABLE`, `PENDING`, `FEES`, `RESERVE` or `PAYOUT` |
| `amount` | Signed decimal delta, e.g. `-7.50000000` |
| `referenceType` | `PAYMENT`, `REFUND`, `SETTLEMENT`, `FEE`, `ADJUSTMENT` or `PAYMENT_SPLIT` |
| `referenceId` | ID of the referenced record |
| `transactionId` | Entries sharing a `transactionId` sum to zero |

Text cells that start with `=`, `+`, `-` or `@` are prefixed with `'` so
spreadsheets do not evaluate them as formulas; plain signed numbers such as
`amount` are left untouched.

Ranges of more than 5000 entries are refused with `400`. Run them as a
background job instead with `POST /v1/exports` and `"resource": "ledger"`
(optional `from`, `to` and `currency`; here `to` is exclusive, as for every
export). It produces the same columns, see [Exports](EXPORTS.md).

## Movement coverage

Payment completion records the gross payment, merchant net, and fee in one
balanced transaction. Refunds debit `AVAILABLE` and credit `PAYOUT` (or
`RESERVE` after settlement). Settlements debit `AVAILABLE` and credit
`PAYOUT`. The migration backfills historical completed payments, refunds, and
settlements. A daily consistency job reports any transaction whose stored
amounts do not sum to zero.

# Stellar

## Overview

FacilPay integrates with the [Stellar](https://stellar.org) network to support multi-sig transactions, trustline management, asset balance lookups, and testnet funding. All Stellar endpoints live under `/v1/stellar` and require a valid JWT.

The module supports two network modes:

| Mode   | `STELLAR_NETWORK` | Horizon network |
| ------ | ----------------- | --------------- |
| `test` | anything except `PUBLIC` | Testnet |
| `live` | `PUBLIC` | Public network |

Use `GET /v1/stellar/mode` to determine which mode the API is currently running in.

## Network Mode

```
GET /v1/stellar/mode
```

Returns whether the API is running in test or live mode.

**Response — `200 OK`**

```json
{
  "mode": "test"
}
```

| Field  | Type     | Description                          |
| ------ | -------- | ------------------------------------ |
| `mode` | `string` | `test` or `live`                     |

---

## Multi-Sig Transactions

When a payment requires more signatures than the source account's own signer weight (i.e. the account's `med_threshold` exceeds the source signer's weight), the transaction is not submitted immediately. Instead it is stored as a multi-sig transaction and signers are expected to add their signatures until the collected weight reaches the required threshold.

### List Multi-Sig Transactions

```
GET /v1/stellar/transactions
```

Returns multi-sig transactions, optionally filtered by status. Each transaction includes its current collected signature count versus the required threshold, so signers can discover which transactions still need their signature.

**Query Parameters**

| Parameter | Type     | Required | Description                                                                 |
| --------- | -------- | -------- | --------------------------------------------------------------------------- |
| `status`  | `string` | No       | Filter by transaction status. One of `pending_signatures`, `submitted`, `failed`. |

**Response — `200 OK`**

```json
[
  {
    "id": "123e4567-e89b-12d3-a456-426614174000",
    "xdr": "AAAAAgAAAAB...",
    "sourceAccount": "GABCD...",
    "status": "pending_signatures",
    "requiredSignatures": 3,
    "collectedSignatures": 1,
    "signers": ["GAX3..."],
    "transactionHash": null,
    "createdAt": "2026-01-26T10:00:00.000Z",
    "updatedAt": "2026-01-26T10:00:00.000Z"
  }
]
```

**`MultiSigTransactionStatus` values**

| Value                | Meaning                                        |
| -------------------- | ---------------------------------------------- |
| `pending_signatures` | Still collecting signatures toward the threshold |
| `submitted`          | Threshold reached and the transaction was submitted |
| `failed`             | The transaction failed                          |

**Error Responses**

| Status | Condition             |
| ------ | --------------------- |
| `401`  | Missing or invalid JWT |

---

### Sign a Multi-Sig Transaction

```
POST /v1/stellar/transactions/:id/sign
```

Adds a signature to a multi-sig transaction. Signatures accumulate toward the account's `med_threshold`. Once the collected signature weight reaches the required threshold, the transaction is automatically submitted to the network and its status changes to `submitted`.

**Path Parameters**

| Parameter | Type     | Description                          |
| --------- | -------- | ------------------------------------ |
| `id`      | `string` | Multi-sig transaction UUID           |

**Request Body**

```json
{
  "signature": "yG/5G2X4...",
  "publicKey": "GAX3..."
}
```

| Field       | Type     | Required | Description                                        |
| ----------- | -------- | -------- | -------------------------------------------------- |
| `signature` | `string` | Yes      | The base64-encoded signature for the transaction   |
| `publicKey` | `string` | Yes      | The public key of the signer                       |

**Response — `200 OK`**

Returns the updated multi-sig transaction. If the threshold was reached, `status` is `submitted` and `transactionHash` is populated.

```json
{
  "id": "123e4567-e89b-12d3-a456-426614174000",
  "xdr": "AAAAAgAAAAB...",
  "sourceAccount": "GABCD...",
  "status": "submitted",
  "requiredSignatures": 3,
  "collectedSignatures": 3,
  "signers": ["GAX3...", "GBY4...", "GCZ5..."],
  "transactionHash": "a1b2c3d4...",
  "createdAt": "2026-01-26T10:00:00.000Z",
  "updatedAt": "2026-01-26T10:00:00.000Z"
}
```

**Error Responses**

| Status | Condition                                                       |
| ------ | --------------------------------------------------------------- |
| `400`  | Invalid signature, signer already signed, signer not authorized, or transaction already submitted/failed |
| `401`  | Missing or invalid JWT                                          |
| `404`  | Transaction not found                                           |

---

## Assets & Trustlines

### List Configured Assets

```
GET /v1/stellar/assets
```

Returns all Stellar assets configured for the authenticated merchant.

**Response — `200 OK`**

```json
[
  {
    "id": "123e4567-e89b-12d3-a456-426614174000",
    "merchantId": "abc123",
    "assetCode": "USDC",
    "assetIssuer": "GAX3...",
    "isAccepted": true,
    "trustlineAddedAt": "2026-01-26T10:00:00.000Z",
    "createdAt": "2026-01-26T10:00:00.000Z",
    "updatedAt": "2026-01-26T10:00:00.000Z"
  }
]
```

**Error Responses**

| Status | Condition             |
| ------ | --------------------- |
| `401`  | Missing or invalid JWT |

---

### Add a Trustline

```
POST /v1/stellar/assets/trustline
```

Adds a trustline for a Stellar asset and marks it as accepted. If the asset already exists for the merchant, it is re-marked as accepted.

**Request Body**

```json
{
  "assetCode": "USDC",
  "assetIssuer": "GAX3..."
}
```

| Field        | Type     | Required | Description                    |
| ------------ | -------- | -------- | ------------------------------ |
| `assetCode`  | `string` | Yes      | The asset code (e.g. `USDC`)   |
| `assetIssuer`| `string` | Yes      | The asset issuer public key    |

**Response — `200 OK`**

Returns the created or updated `StellarAsset`.

**Error Responses**

| Status | Condition             |
| ------ | --------------------- |
| `400`  | Missing required fields |
| `401`  | Missing or invalid JWT |

---

### Remove a Trustline

```
DELETE /v1/stellar/assets/trustline
```

Removes a trustline for a Stellar asset by marking it as not accepted.

**Request Body**

```json
{
  "assetCode": "USDC",
  "assetIssuer": "GAX3..."
}
```

| Field        | Type     | Required | Description                    |
| ------------ | -------- | -------- | ------------------------------ |
| `assetCode`  | `string` | Yes      | The asset code (e.g. `USDC`)   |
| `assetIssuer`| `string` | Yes      | The asset issuer public key    |

**Response — `204 No Content`**

**Error Responses**

| Status | Condition             |
| ------ | --------------------- |
| `401`  | Missing or invalid JWT |
| `404`  | Asset not found        |

---

## Balances

```
GET /v1/stellar/balances
```

Returns current balances for all configured and accepted Stellar assets of the authenticated merchant.

**Response — `200 OK`**

```json
[
  {
    "assetCode": "USDC",
    "assetIssuer": "GAX3...",
    "balance": "1250.5000000"
  },
  {
    "assetCode": "XLM",
    "assetIssuer": "GABCD...",
    "balance": "0",
    "error": "Failed to fetch balance"
  }
]
```

| Field        | Type     | Description                                        |
| ------------ | -------- | -------------------------------------------------- |
| `assetCode`  | `string` | The asset code                                     |
| `assetIssuer`| `string` | The asset issuer public key                        |
| `balance`    | `string` | Current balance (as a string to preserve precision) |
| `error`      | `string` | Present only when the balance could not be fetched  |

**Error Responses**

| Status | Condition             |
| ------ | --------------------- |
| `401`  | Missing or invalid JWT |

---

## Testnet Funding

```
POST /v1/stellar/fund-testnet
```

Funds a Stellar testnet account with test lumens using [Friendbot](https://friendbot.stellar.org). This endpoint is **only available in test mode** and returns a `400` error when the API is running in live mode.

**Request Body**

```json
{
  "address": "GABCD..."
}
```

| Field     | Type     | Required | Description                    |
| --------- | -------- | -------- | ------------------------------ |
| `address` | `string` | Yes      | The testnet account to fund    |

**Response — `200 OK`**

Returns the Friendbot response payload.

**Error Responses**

| Status | Condition                                        |
| ------ | ------------------------------------------------ |
| `400`  | Invalid request or not in testnet mode            |
| `401`  | Missing or invalid JWT                            |
| `500`  | Failed to fund the testnet account                |

---

## Path Quotes and Settlement Conversion

```
GET /v1/stellar/paths?sourceAsset=XLM&destAsset=USDC:GABC...&amount=95&mode=strict-send
```

Returns the best Horizon payment path for the requested assets and amount. `sourceAsset` and `destAsset` are `XLM` or `CODE:ISSUER`; `amount` is a positive decimal with at most 7 fractional digits and `mode` is `strict-send` or `strict-receive`. The response includes the best `destAmount`, the intermediate `path`, a `slippageEstimatePercent` (difference between the best and next-best path, or `null`) and whether the result came from the short-lived quote cache.

When a merchant configures a `settlementAsset` (see [SETTLEMENTS.md](SETTLEMENTS.md)), the settlements service uses this quote to convert every non-matching payment balance with a **strict-send path payment**. The minimum received amount is `quoted destAmount × (1 − maxSlippagePercent / 100)` and is enforced on-chain by Horizon. If the quote's slippage estimate exceeds the configured limit, or the executed amount is below that minimum, the settlement is marked `FAILED` with a `failureReason` and no payout is recorded.

Conversions that require additional signatures are stored as pending multi-sig transactions and leave the settlement in `pending` state until the threshold is reached. The executed rate, actual slippage, Stellar network fee and conversion transaction hash are persisted on the settlement and shown on its statement.

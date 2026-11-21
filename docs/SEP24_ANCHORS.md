# SEP-24 Anchors — Fiat On-Ramp & Off-Ramp

## Overview

FacilPay integrates with Stellar SEP-24 anchors to let merchants cash out to a bank account (off-ramp / withdrawal) and let payers fund payments using fiat (on-ramp / deposit).

The integration is fully server-side:

| Protocol | Purpose |
|----------|---------|
| **SEP-1**  | Discover anchor endpoints from `stellar.toml` |
| **SEP-10** | Server-to-anchor challenge/response authentication (JWT) |
| **SEP-24** | Interactive anchor asset transfer (withdrawal / deposit) |

All endpoints live under `/v1/anchors` and require a valid JWT.

---

## Anchor Configuration

Before starting a withdrawal, register the anchor you want to use.

### List Configured Anchors

```
GET /v1/anchors/configs
```

**Response — `200 OK`** — array of `AnchorConfig` objects.

---

### Register an Anchor

```
POST /v1/anchors/configs
```

**Request Body**

```json
{
  "homeDomain": "testanchor.stellar.org",
  "supportedAssets": ["USDC", "SRT"],
  "isActive": true
}
```

| Field             | Type       | Required | Description |
|-------------------|------------|----------|-------------|
| `homeDomain`      | `string`   | Yes      | Anchor home domain; `stellar.toml` is fetched from `https://<homeDomain>/.well-known/stellar.toml` |
| `supportedAssets` | `string[]` | Yes      | Asset codes this anchor handles (1–12 alphanumeric chars each) |
| `isActive`        | `boolean`  | No       | Defaults to `true` |

**Response — `201 Created`** — the new `AnchorConfig`.

**Error Responses**

| Status | Condition |
|--------|-----------|
| `409`  | An anchor config for this home domain already exists |
| `422`  | Validation failure |

---

### Remove an Anchor

```
DELETE /v1/anchors/configs/:id
```

**Response — `204 No Content`**

---

## Withdrawals (Off-Ramp)

### Start an Interactive Withdrawal

```
POST /v1/anchors/withdrawals
```

Authenticates with the anchor via SEP-10 (server-side, no browser required), calls SEP-24 `/transactions/withdraw/interactive`, and returns the interactive URL the user should visit to complete bank / KYC details.

**Request Body**

```json
{
  "anchorConfigId": "123e4567-...",
  "assetCode": "USDC",
  "amount": "250.00",
  "email": "user@example.com"
}
```

| Field           | Type     | Required | Description |
|-----------------|----------|----------|-------------|
| `anchorConfigId`| `string` | Yes      | UUID of a registered anchor config |
| `assetCode`     | `string` | Yes      | Asset to withdraw (must be in the config's `supportedAssets`) |
| `amount`        | `string` | Yes      | Amount to withdraw |
| `email`         | `string` | No       | Passed to the anchor's interactive flow |

**Response — `201 Created`**

```json
{
  "id": "wd-uuid",
  "merchantId": "...",
  "anchorTransactionId": "anchor-tx-id",
  "assetCode": "USDC",
  "amount": "250.00",
  "status": "PENDING_USER",
  "interactiveUrl": "https://testanchor.stellar.org/sep24/transactions/withdraw/webapp?transaction_id=...",
  ...
}
```

The `interactiveUrl` should be opened by the user in a browser to complete the anchor's KYC / bank-account flow.

**Error Responses**

| Status | Condition |
|--------|-----------|
| `400`  | Asset not supported by this anchor |
| `404`  | Anchor config not found or inactive |
| `500`  | Anchor returned an unexpected response |

---

### List Withdrawals

```
GET /v1/anchors/withdrawals
```

**Query Parameters**

| Parameter | Type   | Required | Description |
|-----------|--------|----------|-------------|
| `status`  | string | No       | Filter: `PENDING_USER`, `PENDING_ANCHOR`, `PENDING_STELLAR`, `COMPLETED`, `FAILED`, `CANCELLED` |
| `limit`   | number | No       | Page size (default: 20, max: 100) |
| `offset`  | number | No       | Offset (default: 0) |

**Response — `200 OK`**

```json
{ "data": [...], "total": 5 }
```

---

### Get a Single Withdrawal

```
GET /v1/anchors/withdrawals/:id
```

**Response — `200 OK`** — single `AnchorWithdrawal`.

---

### Force a Status Sync

```
POST /v1/anchors/withdrawals/:id/sync
```

Immediately polls the anchor for the latest status instead of waiting for the next scheduled poll. Useful during testing.

**Response — `200 OK`** — updated `AnchorWithdrawal`.

---

## Withdrawal Status Lifecycle

```
PENDING_USER
    │  User completes interactive flow
    ▼
PENDING_ANCHOR  ◄── anchor processing
    │
    ▼
PENDING_STELLAR ──► (platform auto-sends the Stellar transaction)
    │
    ▼
COMPLETED
```

Any state can transition to `FAILED`.

| Status           | Meaning |
|------------------|---------|
| `PENDING_USER`   | User has not yet completed the interactive flow |
| `PENDING_ANCHOR` | Anchor is processing the withdrawal |
| `PENDING_STELLAR`| Anchor is waiting for the platform to send on-chain funds |
| `COMPLETED`      | Fiat has been disbursed |
| `FAILED`         | Anchor reported an error or the Stellar send failed |
| `CANCELLED`      | Cancelled before the on-chain send |

---

## Webhook Events

| Event type                          | Fired when |
|-------------------------------------|------------|
| `anchor.withdrawal.started`         | A new withdrawal is initiated |
| `anchor.withdrawal.status_changed`  | Status transitions to any new value |

---

## Automatic Polling

The platform polls every minute for all withdrawals in `PENDING_USER`, `PENDING_ANCHOR`, or `PENDING_STELLAR` status. When a withdrawal enters `PENDING_STELLAR`, the platform automatically submits the Stellar on-chain transaction using `StellarService.sendPayout()`.

---

## Configuration

| Env variable             | Required | Description |
|--------------------------|----------|-------------|
| `STELLAR_SOURCE_SECRET`  | Yes      | The platform keypair used for SEP-10 auth and on-chain sends |
| `STELLAR_NETWORK`        | No       | `PUBLIC` for mainnet, anything else for testnet |

---

## Testing Against the SDF Testnet Anchor

Register the SDF reference anchor:

```bash
curl -X POST /v1/anchors/configs \
  -H 'Authorization: Bearer <jwt>' \
  -d '{"homeDomain":"testanchor.stellar.org","supportedAssets":["SRT","USDC"]}'
```

Then start a withdrawal:

```bash
curl -X POST /v1/anchors/withdrawals \
  -H 'Authorization: Bearer <jwt>' \
  -d '{"anchorConfigId":"<id>","assetCode":"SRT","amount":"10"}'
```

Open the returned `interactiveUrl` in a browser to complete the demo flow.

---

## Database

The feature is backed by two tables added in migration `1792900000000-CreateAnchorTables`. Roll back with:

```bash
npm run migrate:revert
```

# WebAuthn / Passkeys

## Overview

FacilPay supports passkeys (WebAuthn) as a second factor after password authentication. Passkeys use public-key cryptography to provide phishing-resistant authentication without requiring TOTP codes.

When a user with 2FA enabled logs in with a correct password, they receive a `twoFactorToken` that can be used with either a TOTP code or a registered passkey to complete authentication.

---

## Configuration

WebAuthn requires two environment variables in production:

| Variable | Description | Default | Example |
|----------|-------------|---------|---------|
| `WEBAUTHN_RP_ID` | Relying Party ID (domain) | Hostname from `APP_URL` | `facilpay.com` |
| `WEBAUTHN_ORIGIN` | Expected origin for WebAuthn ceremonies | `APP_URL` | `https://app.facilpay.com` |
| `WEBAUTHN_RP_NAME` | Relying Party display name | `FacilPay` | `FacilPay` |

The Relying Party ID must match the domain where the passkey is used. For example, if your frontend is hosted at `https://app.facilpay.com`, set:

```bash
WEBAUTHN_RP_ID=facilpay.com
WEBAUTHN_ORIGIN=https://app.facilpay.com
```

In development, both default to values derived from `APP_URL` (typically `localhost` and `http://localhost:3000`).

See [ENVIRONMENT.md](ENVIRONMENT.md) for the complete configuration reference.

---

## Registration Flow

Passkey registration is a two-step ceremony: request options, then verify the credential response.

### Step 1 — Request registration options

```
POST /v1/auth/webauthn/registration/options
Authorization: Bearer <access_token>
```

No request body required.

**Response (200 OK):**
```json
{
  "options": {
    "challenge": "randomBase64Challenge",
    "rp": {
      "name": "FacilPay",
      "id": "facilpay.com"
    },
    "user": {
      "id": "base64UserId",
      "name": "user@example.com",
      "displayName": "User Name"
    },
    "pubKeyCredParams": [
      { "type": "public-key", "alg": -7 },
      { "type": "public-key", "alg": -257 }
    ],
    "authenticatorSelection": {
      "residentKey": "preferred",
      "userVerification": "required"
    },
    "excludeCredentials": [],
    "attestation": "none"
  },
  "challengeToken": "short-lived-jwt-token"
}
```

The `challengeToken` is valid for 5 minutes and must be passed in the verification step.

### Step 2 — Create credential and verify

Pass the `options` to `navigator.credentials.create()` in the browser:

```javascript
const credential = await navigator.credentials.create({
  publicKey: options
});

const credentialJSON = {
  id: credential.id,
  rawId: arrayBufferToBase64(credential.rawId),
  response: {
    clientDataJSON: arrayBufferToBase64(credential.response.clientDataJSON),
    attestationObject: arrayBufferToBase64(credential.response.attestationObject),
    transports: credential.response.getTransports?.() || []
  },
  type: credential.type
};
```

Submit the credential response to complete registration:

```
POST /v1/auth/webauthn/registration/verify
Authorization: Bearer <access_token>
```

**Request Body:**
```json
{
  "challengeToken": "short-lived-jwt-token-from-step-1",
  "name": "Work laptop",
  "response": {
    "id": "credential-id-base64",
    "rawId": "credential-id-base64",
    "response": {
      "clientDataJSON": "base64-encoded",
      "attestationObject": "base64-encoded",
      "transports": ["internal"]
    },
    "type": "public-key"
  }
}
```

**Response (200 OK):**
```json
{
  "id": "credential-uuid",
  "credentialId": "credential-id-base64",
  "name": "Work laptop",
  "transports": ["internal"],
  "createdAt": "2026-10-17T10:00:00.000Z",
  "lastUsedAt": null
}
```

**Response (401 Unauthorized):**
```json
{
  "statusCode": 401,
  "message": "Invalid passkey registration response",
  "error": "Unauthorized"
}
```

The challenge is consumed upon verification and cannot be reused.

---

## Authentication Flow

Passkey authentication is also a two-step ceremony, but it requires a `twoFactorToken` from the initial password login.

### Step 1 — Password login

Submit credentials as usual:

```
POST /v1/auth/login
```

**Request Body:**
```json
{
  "email": "user@example.com",
  "password": "P@ssw0rd!"
}
```

If 2FA is enabled, the response is **202 Accepted** with a `twoFactorToken`:

```json
{
  "2fa_required": true,
  "message": "Two-factor authentication code required",
  "twoFactorToken": "short-lived-signed-token",
  "availableMethods": ["totp", "passkey"]
}
```

The `twoFactorToken` is valid for 5 minutes.

### Step 2 — Request authentication options

```
POST /v1/auth/webauthn/authentication/options
```

**Request Body:**
```json
{
  "twoFactorToken": "short-lived-signed-token"
}
```

**Response (200 OK):**
```json
{
  "options": {
    "challenge": "randomBase64Challenge",
    "rpId": "facilpay.com",
    "userVerification": "required",
    "allowCredentials": [
      {
        "id": "credential-id-base64",
        "type": "public-key",
        "transports": ["internal"]
      }
    ]
  },
  "challengeToken": "short-lived-jwt-token"
}
```

**Response (401 Unauthorized):**
```json
{
  "statusCode": 401,
  "message": "No passkeys are registered for this user",
  "error": "Unauthorized"
}
```

### Step 3 — Get assertion and verify

Pass the `options` to `navigator.credentials.get()`:

```javascript
const assertion = await navigator.credentials.get({
  publicKey: options
});

const assertionJSON = {
  id: assertion.id,
  rawId: arrayBufferToBase64(assertion.rawId),
  response: {
    clientDataJSON: arrayBufferToBase64(assertion.response.clientDataJSON),
    authenticatorData: arrayBufferToBase64(assertion.response.authenticatorData),
    signature: arrayBufferToBase64(assertion.response.signature),
    userHandle: assertion.response.userHandle ? arrayBufferToBase64(assertion.response.userHandle) : null
  },
  type: assertion.type
};
```

Submit the assertion to complete authentication:

```
POST /v1/auth/webauthn/authentication/verify
```

**Request Body:**
```json
{
  "twoFactorToken": "short-lived-signed-token-from-login",
  "challengeToken": "short-lived-jwt-token-from-step-2",
  "response": {
    "id": "credential-id-base64",
    "rawId": "credential-id-base64",
    "response": {
      "clientDataJSON": "base64-encoded",
      "authenticatorData": "base64-encoded",
      "signature": "base64-encoded",
      "userHandle": "base64-encoded-or-null"
    },
    "type": "public-key"
  }
}
```

**Response (200 OK):**
```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refresh_token": "550e8400-e29b-41d4-a716-446655440000",
  "user": {
    "id": "abc123",
    "email": "user@example.com",
    "roles": ["USER"],
    "isEmailVerified": true
  }
}
```

**Response (401 Unauthorized):**
```json
{
  "statusCode": 401,
  "message": "Invalid passkey response",
  "error": "Unauthorized"
}
```

---

## Credential Management

### List passkeys

```
GET /v1/auth/webauthn/credentials
Authorization: Bearer <access_token>
```

**Response (200 OK):**
```json
[
  {
    "id": "credential-uuid",
    "credentialId": "credential-id-base64",
    "name": "Work laptop",
    "transports": ["internal"],
    "createdAt": "2026-10-17T10:00:00.000Z",
    "lastUsedAt": "2026-10-17T12:00:00.000Z"
  },
  {
    "id": "credential-uuid-2",
    "credentialId": "credential-id-base64-2",
    "name": "Phone",
    "transports": ["hybrid"],
    "createdAt": "2026-10-16T08:00:00.000Z",
    "lastUsedAt": null
  }
]
```

### Rename a passkey

```
PATCH /v1/auth/webauthn/credentials/:id
Authorization: Bearer <access_token>
```

**Request Body:**
```json
{
  "name": "New laptop"
}
```

**Response (200 OK):**
```json
{
  "id": "credential-uuid",
  "credentialId": "credential-id-base64",
  "name": "New laptop",
  "transports": ["internal"],
  "createdAt": "2026-10-17T10:00:00.000Z",
  "lastUsedAt": "2026-10-17T12:00:00.000Z"
}
```

**Response (404 Not Found):**
```json
{
  "statusCode": 404,
  "message": "Passkey not found",
  "error": "Not Found"
}
```

### Delete a passkey

```
DELETE /v1/auth/webauthn/credentials/:id
Authorization: Bearer <access_token>
```

**Response (204 No Content)**

**Response (404 Not Found):**
```json
{
  "statusCode": 404,
  "message": "Passkey not found",
  "error": "Not Found"
}
```

---

## Security Details

### Challenge Lifetime
Registration and authentication challenges expire after 5 minutes. Each challenge is single-use and is consumed upon successful verification.

### User Verification
User verification is required for all passkey ceremonies. This typically means a biometric check (Face ID, Touch ID, Windows Hello) or a device PIN.

### Signature Counter
Authenticators that report a signature counter are validated to ensure the counter advances. A non-advancing counter is rejected as a potential cloned credential.

### Challenge Storage
Challenges are stored in the `webauthn_challenges` table with:
- `userId` — Owner of the challenge
- `purpose` — Either `registration` or `authentication`
- `challenge` — The random challenge string
- `expiresAt` — Expiry timestamp
- `consumedAt` — Consumption timestamp (null until used)

Expired challenges are pruned daily at 2 AM UTC.

---

## Interaction with TOTP 2FA

Passkeys and TOTP are both valid second factors. A user can have:
- TOTP enabled with zero passkeys → must use TOTP code
- TOTP enabled with one or more passkeys → can use either TOTP code or any registered passkey
- TOTP disabled → no second factor required (passkeys are not used)

The `availableMethods` array in the 202 login response indicates which methods are available:

```json
{
  "2fa_required": true,
  "twoFactorToken": "...",
  "availableMethods": ["totp", "passkey"]
}
```

When TOTP is disabled, disabling it does not remove registered passkeys, but they will not be prompted during login.

---

## Complete curl Walkthrough

### Register a passkey

```bash
# 1. Log in to get an access token
ACCESS_TOKEN=$(curl -s -X POST http://localhost:3000/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com","password":"P@ssw0rd!"}' \
  | jq -r '.access_token')

# 2. Request registration options
REGISTRATION_OPTIONS=$(curl -s -X POST http://localhost:3000/v1/auth/webauthn/registration/options \
  -H "Authorization: Bearer $ACCESS_TOKEN")

echo "$REGISTRATION_OPTIONS" | jq .

# 3. (In browser) Pass options.options to navigator.credentials.create()
# and capture the response

# 4. Verify the credential
curl -X POST http://localhost:3000/v1/auth/webauthn/registration/verify \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "challengeToken": "token-from-step-2",
    "name": "My Device",
    "response": { "...": "credential-response-from-browser" }
  }'
```

### Authenticate with a passkey

```bash
# 1. Password login returns twoFactorToken
TWO_FACTOR_TOKEN=$(curl -s -X POST http://localhost:3000/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com","password":"P@ssw0rd!"}' \
  | jq -r '.twoFactorToken')

# 2. Request authentication options
AUTH_OPTIONS=$(curl -s -X POST http://localhost:3000/v1/auth/webauthn/authentication/options \
  -H "Content-Type: application/json" \
  -d "{\"twoFactorToken\":\"$TWO_FACTOR_TOKEN\"}")

echo "$AUTH_OPTIONS" | jq .

# 3. (In browser) Pass options.options to navigator.credentials.get()
# and capture the assertion

# 4. Verify the assertion
curl -X POST http://localhost:3000/v1/auth/webauthn/authentication/verify \
  -H "Content-Type: application/json" \
  -d '{
    "twoFactorToken": "'"$TWO_FACTOR_TOKEN"'",
    "challengeToken": "token-from-step-2",
    "response": { "...": "assertion-from-browser" }
  }'
```

### List and manage passkeys

```bash
# List all registered passkeys
curl -s -X GET http://localhost:3000/v1/auth/webauthn/credentials \
  -H "Authorization: Bearer $ACCESS_TOKEN" | jq .

# Rename a passkey
curl -X PATCH http://localhost:3000/v1/auth/webauthn/credentials/credential-uuid \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"New name"}'

# Delete a passkey
curl -X DELETE http://localhost:3000/v1/auth/webauthn/credentials/credential-uuid \
  -H "Authorization: Bearer $ACCESS_TOKEN"
```

---

## Error Reference

| Status | Message | Cause |
|--------|---------|-------|
| 401 | `Invalid passkey registration response` | Verification failed during registration |
| 401 | `Invalid passkey response` | Verification failed during authentication |
| 401 | `Invalid passkey challenge` | Challenge token is invalid or expired |
| 401 | `Passkey challenge expired` | Challenge has expired or already been consumed |
| 401 | `Passkey challenge already used` | Challenge has been consumed by a previous verification |
| 401 | `Passkey signature counter did not advance` | Authenticator counter did not increment (potential clone) |
| 401 | `Passkey signature counter changed` | Concurrent authentication detected (race condition) |
| 401 | `No passkeys are registered for this user` | User has no passkeys during authentication |
| 401 | `Invalid two-factor login token` | `twoFactorToken` is invalid or expired |
| 404 | `Passkey not found` | Credential not found or not owned by user |

---

## Database Schema

### webauthn_credentials table

```sql
id                UUID PRIMARY KEY
userId            UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE
credentialId      BYTEA NOT NULL UNIQUE  -- WebAuthn credential ID
publicKey         BYTEA NOT NULL         -- Public key
counter           BIGINT NOT NULL        -- Signature counter
transports        TEXT[]                 -- Transports (e.g., ["internal", "hybrid"])
name              VARCHAR(100) NOT NULL  -- User-assigned name
lastUsedAt        TIMESTAMP              -- Last authentication timestamp
createdAt         TIMESTAMP NOT NULL
updatedAt         TIMESTAMP NOT NULL
```

### webauthn_challenges table

```sql
id         UUID PRIMARY KEY
userId     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE
purpose    VARCHAR(20) NOT NULL  -- "registration" or "authentication"
challenge  TEXT NOT NULL         -- Base64-encoded challenge
expiresAt  TIMESTAMP NOT NULL
consumedAt TIMESTAMP             -- NULL until used
createdAt  TIMESTAMP NOT NULL
```

Migrations:
- `webauthn_credentials`: TBD
- `webauthn_challenges`: TBD

---

## See Also

- [Two-Factor Auth](TWO_FACTOR_AUTH.md) — TOTP and backup codes
- [Environment](ENVIRONMENT.md) — Configuration reference
- [Sessions](SESSIONS.md) — Session management

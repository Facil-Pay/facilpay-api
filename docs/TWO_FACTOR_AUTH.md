# Two-Factor Authentication (2FA)

## Overview

FacilPay supports TOTP-based two-factor authentication (RFC 6238), compatible with apps like Google Authenticator, Authy, and 1Password. When enabled, login requires a 6-digit code (or a single-use backup code) in addition to a password.

The TOTP secret is encrypted at rest using AES-256-GCM before being stored in the database.

---

## Setup Flow

Enabling 2FA is a two-step process: generate the secret, then confirm a valid TOTP code to activate it.

### Step 1 — Generate secret and QR code

```
POST /v1/auth/2fa/enable
Authorization: Bearer <access_token>
```

No request body required.

**Response (200 OK):**
```json
{
  "secret": "JBSWY3DPEHPK3PXP",
  "qrCodeUri": "data:image/png;base64,...",
  "otpauthUri": "otpauth://totp/FacilPay:jane.doe%40example.com?secret=JBSWY3DPEHPK3PXP&issuer=FacilPay&algorithm=SHA1&digits=6&period=30",
  "backupCodes": [
    "a1b2c3d4",
    "e5f6a7b8",
    "..."
  ]
}
```

- `qrCodeUri` is a base64-encoded PNG ready to render as an `<img>` tag.
- `otpauthUri` can be used directly with authenticator apps that accept URI input.
- `backupCodes` — 10 single-use codes are generated here. **These are only shown once.** Store them securely.

> **Note:** Calling this endpoint again before verifying will regenerate the secret and backup codes, invalidating the previous ones.

### Step 2 — Verify and activate

```
POST /v1/auth/2fa/verify
Authorization: Bearer <access_token>
```

**Request Body:**
```json
{
  "code": "123456"
}
```

**Response (200 OK):**
```json
{
  "message": "Two-factor authentication enabled",
  "twoFactorEnabled": true
}
```

**Response (401 Unauthorized):**
```json
{
  "statusCode": 401,
  "message": "Invalid two-factor code",
  "error": "Unauthorized"
}
```

**Response (400 Bad Request):**
```json
{
  "statusCode": 400,
  "message": "Two-factor authentication is not set up",
  "error": "Bad Request"
}
```

2FA is not active until this verification step succeeds. Until then, login does not require a code.

---

## Login with 2FA

### Step 1 — Submit credentials

```
POST /v1/auth/login
```

**Request Body:**
```json
{
  "email": "jane.doe@example.com",
  "password": "P@ssw0rd!"
}
```

If 2FA is enabled and no `twoFactorCode` is provided, the server returns **202 Accepted** instead of tokens:

```json
{
  "2fa_required": true,
  "message": "Two-factor authentication code required",
  "twoFactorToken": "short-lived-signed-token",
  "availableMethods": ["totp", "passkey"]
}
```

The `twoFactorToken` is valid for five minutes and can be used with either a TOTP code or a registered passkey. A passkey registered on an account also requires this password-first step at login.

### Step 2 — Resubmit with TOTP code

```
POST /v1/auth/login
```

**Request Body:**
```json
{
  "email": "jane.doe@example.com",
  "password": "P@ssw0rd!",
  "twoFactorCode": "123456"
}
```

**Response (200 OK):**
```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refresh_token": "550e8400-e29b-41d4-a716-446655440000",
  "user": {
    "id": "abc123",
    "email": "jane.doe@example.com",
    "roles": ["USER"],
    "isEmailVerified": true
  }
}
```

**Response (401 Unauthorized):**
```json
{
  "statusCode": 401,
  "message": "Invalid two-factor code",
  "error": "Unauthorized"
}
```

### Using a backup code instead

If the authenticator app is unavailable, pass a backup code in the `twoFactorCode` field. Backup codes are 8–10 character alphanumeric strings:

```json
{
  "email": "jane.doe@example.com",
  "password": "P@ssw0rd!",
  "twoFactorCode": "a1b2c3d4"
}
```

Each backup code is single-use and is permanently consumed on successful authentication.

### Using a passkey

Register a passkey while authenticated. First request options:

```
POST /v1/auth/webauthn/registration/options
Authorization: Bearer <access_token>
```

Pass the returned `options` to `navigator.credentials.create()`, then submit its JSON response:

```
POST /v1/auth/webauthn/registration/verify
Authorization: Bearer <access_token>
```

```json
{
  "challengeToken": "short-lived-registration-token",
  "name": "Work laptop",
  "response": { "id": "...", "response": { "...": "..." } }
}
```

After password login returns `twoFactorToken`, request assertion options and pass the returned `options` to `navigator.credentials.get()`:

```
POST /v1/auth/webauthn/authentication/options
```

Then submit the assertion to complete login:

```
POST /v1/auth/webauthn/authentication/verify
```

```json
{
  "twoFactorToken": "short-lived-signed-token",
  "challengeToken": "short-lived-authentication-token",
  "response": { "id": "...", "response": { "...": "..." } }
}
```

The challenge is single-use and expires after five minutes. User verification is required, and a non-advancing signature counter is rejected for authenticators that report counters.

Manage registered credentials using the authenticated endpoints:

- `GET /v1/auth/webauthn/credentials` lists passkey metadata.
- `PATCH /v1/auth/webauthn/credentials/:id` renames a passkey with `{ "name": "..." }`.
- `DELETE /v1/auth/webauthn/credentials/:id` removes a passkey.

Configure `WEBAUTHN_RP_ID` and `WEBAUTHN_ORIGIN` to match the browser-facing domain in production. They default to the hostname and origin in `APP_URL`.

> **Note:** The failed-login-attempt counter (and the resulting account lockout) is only driven by wrong passwords. Failed-login attempts are reset as soon as the password check succeeds, before the 2FA code is checked, so an incorrect `twoFactorCode` or backup code never increments that counter — it simply returns `401 Invalid two-factor code`. A user who knows the correct password can retry `twoFactorCode` indefinitely without triggering a lockout.

---

## Disabling 2FA

```
POST /v1/auth/2fa/disable
Authorization: Bearer <access_token>
```

**Request Body:**
```json
{
  "password": "P@ssw0rd!"
}
```

Password confirmation is required to prevent unauthorized disabling of 2FA (e.g., if a session token is compromised).

**Response (200 OK):**
```json
{
  "message": "Two-factor authentication disabled",
  "twoFactorEnabled": false
}
```

**Response (401 Unauthorized):**
```json
{
  "statusCode": 401,
  "message": "Invalid password",
  "error": "Unauthorized"
}
```

**Response (400 Bad Request):**
```json
{
  "statusCode": 400,
  "message": "Two-factor authentication is not enabled",
  "error": "Bad Request"
}
```

Disabling 2FA clears the encrypted secret and all backup codes from the database.

---

## Backup Codes

### Generation

10 backup codes are generated automatically when `POST /v1/auth/2fa/enable` is called. Each code is an 8-character hex string (e.g., `a1b2c3d4`). The plain-text codes are returned only once; only bcrypt hashes are stored.

### Usage

Backup codes are accepted anywhere a TOTP code is accepted (the `twoFactorCode` field on login). A code is consumed immediately upon use and cannot be reused.

### Regeneration

To get a fresh set of backup codes without touching the TOTP secret:

```
POST /v1/auth/2fa/backup-codes/regenerate
Authorization: Bearer <access_token>
```

**Request Body** (provide **either** the password **or** a valid TOTP code):
```json
{
  "password": "P@ssw0rd!"
}
```

or

```json
{
  "twoFactorCode": "123456"
}
```

**Response (201 Created):**
```json
{
  "backupCodes": [
    "a1b2c3d4",
    "e5f6a7b8",
    "..."
  ]
}
```

- The TOTP secret and `twoFactorEnabled` state are **unchanged** — 2FA stays active and there is no need to re-run `/2fa/verify`.
- The previous backup codes are invalidated atomically in the same transaction that stores the new ones.
- Backup codes cannot be used to regenerate (only a password or a live TOTP code is accepted), so a compromised backup code cannot rotate the set.

**Response (400 Bad Request):**
```json
{
  "statusCode": 400,
  "message": "Two-factor authentication is not enabled",
  "error": "Bad Request"
}
```

**Response (401 Unauthorized):**
```json
{
  "statusCode": 401,
  "message": "Invalid password",
  "error": "Unauthorized"
}
```

---

## Complete curl Walkthrough

```bash
# 1. Log in to get an access token
curl -s -X POST http://localhost:3000/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"jane.doe@example.com","password":"P@ssw0rd!"}' \
  | jq -r '.access_token'
# → eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

# 2. Start 2FA setup (save the secret and backup codes)
curl -s -X POST http://localhost:3000/v1/auth/2fa/enable \
  -H "Authorization: Bearer <access_token>"

# 3. Scan the QR code / enter the secret in your authenticator app

# 4. Confirm with the first TOTP code
curl -s -X POST http://localhost:3000/v1/auth/2fa/verify \
  -H "Authorization: Bearer <access_token>" \
  -H "Content-Type: application/json" \
  -d '{"code":"123456"}'

# 5. Next login — first call returns 202
curl -s -X POST http://localhost:3000/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"jane.doe@example.com","password":"P@ssw0rd!"}'
# → {"2fa_required":true,"message":"Two-factor authentication code required"}

# 6. Re-submit with the current TOTP code
curl -s -X POST http://localhost:3000/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"jane.doe@example.com","password":"P@ssw0rd!","twoFactorCode":"654321"}'
# → {"access_token":"...","refresh_token":"...","user":{...}}

# 7. Disable 2FA when needed
curl -s -X POST http://localhost:3000/v1/auth/2fa/disable \
  -H "Authorization: Bearer <access_token>" \
  -H "Content-Type: application/json" \
  -d '{"password":"P@ssw0rd!"}'
```

---

## Security Details

### Secret Storage
The TOTP secret is encrypted with AES-256-GCM using a key derived from `TWO_FACTOR_ENCRYPTION_KEY`. A random IV is generated per encryption, stored alongside the ciphertext. The secret is never stored in plain text.

### Backup Code Storage
Backup codes are hashed with bcrypt (cost factor 10) before storage. Plain-text codes are only held in memory during the `/2fa/enable` response.

### TOTP Window
Code verification uses the standard ±1 window (30-second period), tolerating minor clock drift between client and server.

### Backup Code Format
Each backup code is 8 hex characters (4 random bytes), giving ~4 billion possible values per code. Codes are single-use and consumed atomically.

---

## Error Reference

| Status | Message | Cause |
|--------|---------|-------|
| 400 | `Two-factor authentication is not set up` | `/2fa/verify` called before `/2fa/enable` |
| 400 | `Two-factor authentication is not enabled` | `/2fa/disable` called when 2FA is already off, or `/2fa/backup-codes/regenerate` when 2FA is not active |
| 400 | `Password or two-factor code is required` | `/2fa/backup-codes/regenerate` called without a password or TOTP code |
| 401 | `Invalid two-factor code` | Wrong TOTP code or backup code on verify/login, or wrong TOTP on regenerate |
| 401 | `Invalid password` | Wrong password on disable or regenerate |

---

## Database Schema

### users table (2FA columns)

```sql
twoFactorSecret   VARCHAR   -- AES-256-GCM encrypted TOTP secret (nullable)
twoFactorEnabled  BOOLEAN   -- Whether 2FA is active
backupCodes       TEXT[]    -- Array of bcrypt-hashed backup codes (nullable)
```

Migration: `1706000000003-AddTwoFactorColumnsToUsers.ts`


## Require 2FA for a merchant team

PATCH /v1/merchants/me/settings with { "require2fa": true } to require enrollment for the owner and every current or future member. GET the same endpoint to read the policy. The default is false. The owner must first enable TOTP or register a passkey; otherwise enabling is rejected. Affected members are notified by email when the policy transitions to enabled.

Members without TOTP or a registered passkey receive 403 with code two_factor_setup_required on authenticated requests. Only POST /v1/auth/2fa/enable, POST /v1/auth/2fa/verify, and the POST /v1/auth/webauthn/registration/options and /verify endpoints remain accessible. Restrictions apply through the shared JWT strategy, including SSE. Setup, challenge and step-up tokens cannot be used as ordinary access tokens.

Passkeys count as a second factor. Users cannot remove their last factor while any team requires 2FA. SAML authentication does not replace local enrollment. API keys remain server-to-server credentials and are not subject to interactive enrollment.

Schema: migration 1795300000000-AddMerchantSecurityPolicies. Coverage: merchant-security.service.spec.ts and test/merchant-security.e2e-spec.ts. Tests and migrations were not run during the edit-only implementation.

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
  "message": "Two-factor authentication code required"
}
```

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

To get a fresh set of backup codes, re-run the enable flow:

1. Call `POST /v1/auth/2fa/enable` — this generates a new secret **and** 10 new backup codes.
2. Call `POST /v1/auth/2fa/verify` with a valid TOTP from the new secret to re-activate 2FA.

> All previous backup codes are invalidated when the enable endpoint is called again.

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
| 400 | `Two-factor authentication is not enabled` | `/2fa/disable` called when 2FA is already off |
| 401 | `Invalid two-factor code` | Wrong TOTP code or backup code on verify/login |
| 401 | `Invalid password` | Wrong password on disable |

---

## Database Schema

### users table (2FA columns)

```sql
twoFactorSecret   VARCHAR   -- AES-256-GCM encrypted TOTP secret (nullable)
twoFactorEnabled  BOOLEAN   -- Whether 2FA is active
backupCodes       TEXT[]    -- Array of bcrypt-hashed backup codes (nullable)
```

Migration: `1706000000003-AddTwoFactorColumnsToUsers.ts`

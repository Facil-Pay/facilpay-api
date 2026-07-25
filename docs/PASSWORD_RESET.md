# Password Reset

## Overview

Secure password reset flow using time-limited tokens sent via email. Includes protection against user enumeration and automatic session invalidation.

## Endpoints

### Request Password Reset

```
POST /auth/forgot-password
```

**Request Body:**
```json
{
  "email": "user@example.com"
}
```

**Response (200 OK):**
```json
{
  "message": "If an account with that email exists, a password reset link has been sent."
}
```

**Security Features:**
- Returns 200 even if email doesn't exist (prevents user enumeration)
- Rate limited to 5 requests per 15 minutes
- Token expires after 1 hour
- Token is cryptographically secure (32 random bytes)

### Reset Password

```
POST /auth/reset-password
```

**Request Body:**
```json
{
  "token": "550e8400-e29b-41d4-a716-446655440000",
  "email": "user@example.com",
  "newPassword": "NewP@ssw0rd!"
}
```

**Response (200 OK):**
```json
{
  "message": "Password reset successful. Please log in again."
}
```

**Response (400 Bad Request):**
```json
{
  "statusCode": 400,
  "message": "Invalid or expired password reset token",
  "error": "Bad Request"
}
```

## Flow

1. **User requests reset:**
   ```bash
   curl -X POST http://localhost:3000/auth/forgot-password \
     -H "Content-Type: application/json" \
     -d '{"email":"user@example.com"}'
   ```

2. **User receives email** with reset link containing token

3. **User submits new password:**
   ```bash
   curl -X POST http://localhost:3000/auth/reset-password \
     -H "Content-Type: application/json" \
     -d '{
       "token":"550e8400-e29b-41d4-a716-446655440000",
       "email":"user@example.com",
       "newPassword":"NewP@ssw0rd!"
     }'
   ```

4. **System actions:**
   - Validates token (not expired, not used, matches email)
   - Updates password with bcrypt hash
   - Marks token as used
   - Invalidates all refresh tokens (logs out all sessions)

## Two-Factor Authentication (2FA) Behavior

When a user with 2FA enabled resets their password:

- **2FA remains active**: The password reset flow does NOT disable two-factor authentication
- **No 2FA code required**: The reset process itself does not require a 2FA code (only the email token)
- **Login after reset**: After successful password reset, the user must log in with their new password AND provide their 2FA code (or use a backup code)
- **2FA settings preserved**: The TOTP secret, enabled status, and backup codes remain unchanged

This design ensures that users who have enabled 2FA maintain their security settings even after password recovery, preventing attackers from bypassing 2FA by initiating a password reset.

### Example Flow for 2FA-Enabled Accounts

1. User requests password reset (no 2FA code needed)
2. User receives email with reset token
3. User submits new password with token
4. System resets password and invalidates all sessions
5. User attempts to log in with new password
6. System prompts for 2FA code (since 2FA is still enabled)
7. User provides 2FA code from authenticator app or backup code
8. Login successful

## Security Features

### User Enumeration Protection
Both existing and non-existing emails receive the same response:
```json
{
  "message": "If an account with that email exists, a password reset link has been sent."
}
```

### Token Security
- Generated using `crypto.randomBytes(32)` for cryptographic strength
- Stored as SHA-256 hash in database
- 1-hour expiration (configurable)
- Single-use only (marked as used after successful reset)

### Session Invalidation
All refresh tokens are revoked on successful password reset, forcing re-authentication on all devices.

### Rate Limiting
Both endpoints are rate limited to 5 requests per 15 minutes per IP address.

## Email Template

The password reset email includes:
- Reset link with token
- Expiration notice (1 hour)
- Security notice (ignore if not requested)

Example:
```
Subject: Reset your FacilPay password

You requested to reset your password.

Click the link below to reset your password:
http://localhost:3000/auth/reset-password?token=550e8400-e29b-41d4-a716-446655440000

This link expires in 1 hour.

If you did not request this, please ignore this email.
```

## Error Scenarios

### Invalid Token
```bash
# Expired, used, or non-existent token
curl -X POST http://localhost:3000/auth/reset-password \
  -d '{"token":"invalid","email":"user@example.com","newPassword":"New123"}'

# Response: 400 Bad Request
{
  "statusCode": 400,
  "message": "Invalid or expired password reset token"
}
```

### Email Mismatch
```bash
# Token valid but email doesn't match
curl -X POST http://localhost:3000/auth/reset-password \
  -d '{"token":"valid-token","email":"wrong@example.com","newPassword":"New123"}'

# Response: 400 Bad Request
{
  "statusCode": 400,
  "message": "Invalid or expired password reset token"
}
```

### Rate Limit Exceeded
```bash
# More than 5 requests in 15 minutes
# Response: 429 Too Many Requests
{
  "statusCode": 429,
  "message": "ThrottlerException: Too Many Requests"
}
```

## Database Schema

### password_reset_tokens Table
```sql
CREATE TABLE password_reset_tokens (
  id UUID PRIMARY KEY,
  userId VARCHAR NOT NULL,
  tokenHash VARCHAR NOT NULL,
  expiresAt TIMESTAMP NOT NULL,
  used BOOLEAN DEFAULT false,
  createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_password_reset_tokens_userId ON password_reset_tokens(userId);
CREATE INDEX idx_password_reset_tokens_tokenHash ON password_reset_tokens(tokenHash);
CREATE INDEX idx_password_reset_tokens_expiresAt ON password_reset_tokens(expiresAt);
```

## Testing

### Unit Tests
```bash
npm test -- password-reset.spec.ts
```

### E2E Tests
```bash
npm run test:e2e -- password-reset.e2e-spec.ts
```

## Configuration

No additional environment variables required. Uses existing SMTP configuration:
- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_USER`
- `SMTP_PASS`
- `SMTP_FROM`
- `APP_URL`

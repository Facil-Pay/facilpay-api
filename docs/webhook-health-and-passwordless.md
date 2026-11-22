# Webhook health, custom headers, and passwordless sessions

Apply migration 1792400000000-WebhookHealthMagicLinksIdleSessions before deploying these changes.
Set WEBHOOK_HEADERS_ENCRYPTION_KEY to a stable, high-entropy secret shared by API and webhook workers. Back it up securely; changing it prevents decryption of existing custom headers. No plaintext fallback is provided.

GET /v1/webhooks/:id/stats returns endpointId and windows keyed by 24h and 7d. Each window includes total, succeeded, failures, successRate (0–1), p50LatencyMs, and p95LatencyMs. It counts the latest recorded attempt of each delivery by lastAttemptAt; pending deliveries are excluded and dead-letter deliveries count as failures. Percentiles include successful and failed attempts with recorded latency. Older deliveries without latency are counted but excluded from percentiles. Empty windows have successRate 0 and null percentiles. Results are cached in each API process for 60 seconds; ownership is checked on every request.

Create/update webhook requests accept a headers object of string values. Updates replace the entire object; use {} to clear it. Responses replace each value with ********. Send actual replacement values when updating; do not round-trip masked responses. Host, Content-Length, transport headers, signature headers and X-FacilPay-* are reserved, case-insensitively. Header names and values are validated to prevent header injection. Custom credentials are not forwarded through redirects.

POST /v1/auth/magic-link accepts { email } and always returns the same message for eligible, ineligible, and nonexistent accounts. Requests are limited to 5 per email and 5 per IP per 15 minutes using shared database counters. Email must already be verified. Links are signed, expire after 15 minutes, and only their SHA-256 hash is stored.

POST /v1/auth/magic-link/verify accepts { token, deviceId? }. It returns the normal access/refresh token pair, or { 2fa_required: true, twoFactorToken, availableMethods }. For TOTP/backup codes, call the same verify endpoint with { token: twoFactorToken, twoFactorCode }. Passkey users can use the existing passkey authentication endpoints with twoFactorToken. Redemption is atomic and single-use. Purpose-scoped JWTs cannot be used as bearer access tokens.

PATCH /v1/merchants/me/settings accepts idleSessionTimeoutMinutes (1–43200, or null to disable). The default is null. Sessions track lastSeenAt; authenticated requests with session-bound access tokens and successful refreshes update activity. Idle, revoked, or absolutely expired sessions cannot refresh. For users belonging to multiple merchants, the strictest configured timeout applies. Access tokens issued before this change lack a session ID; refreshing them issues a session-bound access token.

Regression specs cover header encryption/masking/validation and delivery, stats/caching, magic-link redemption/2FA/rate limits, and idle expiration. webhooks-stats.integration.spec.ts uses TEST_DATABASE_URL for PostgreSQL seed-based percentile checks, with a connection-local temporary table. No commands or migrations were run as part of this edit-only change.

# API request logs

Authenticated merchants can inspect API-key-authenticated requests from the last 30 days:

- GET /v1/request-logs: paginated records (data, total, page, limit).
- GET /v1/request-logs/:id: one record; another merchant's record returns 404.

List filters: apiKeyId (UUID), method (uppercase HTTP verb), path (exact route template), status (100–599), idempotencyKey, from/to (ISO timestamps), page (default 1), limit (default 20, maximum 100).

Records contain method, route template, status, latencyMs, apiKeyId, idempotencyKey, redacted requestBody/responseBody, and createdAt. Query strings and route parameter values are deliberately excluded from path to avoid recording tokens. API key values, authorization headers and cookies are never recorded.

Redaction recursively removes sensitive fields including secrets, passwords, tokens, API keys, credentials, OTPs, SAML assertions and card details. Unknown string values and free text are also redacted; only short known-safe categorical fields are retained. Bodies are bounded to 32 KiB, eight levels, and 100 entries per collection. Non-JSON responses have no captured body.

Persistence runs in a later event-loop turn after the response finishes. Database failures cannot fail the API request. The best-effort in-process queue is capped at 1,000 outstanding records; overload or process shutdown can lose logs. This is a debugging facility, not the audit log. The daily retention job deletes records older than 30 days, and reads enforce the cutoff even before cleanup runs.

Schema: migration 1795300000001-CreateRequestLogs has matching up/down methods. Unit coverage: request-logs.service.spec.ts. HTTP coverage: test/request-logs.e2e-spec.ts. Tests and migrations must be validated in a configured environment; they were not executed as part of this change.

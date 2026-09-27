# Environment Variables

This document lists every configuration variable read by the FacilPay API,
grouped by area. Each entry shows the variable name, description, default, and
whether it is required in production.

> ⚠️ **Production checklist** — at minimum change `JWT_SECRET`,
> `TWO_FACTOR_ENCRYPTION_KEY`, `WEBHOOK_SECRET`, and `STELLAR_SOURCE_SECRET`,
> set `DATABASE_SYNCHRONIZE=false`, and use `STELLAR_NETWORK=PUBLIC`.

## App

| Variable | Description | Default | Required | Example |
| --- | --- | --- | --- | --- |
| `PORT` | HTTP port the server binds to | `3000` | No | `3000` |
| `NODE_ENV` | Runtime environment | `development` | No | `production` |
| `SERVICE_NAME` | Service name used in logs | `facilpay-api` | No | `facilpay-api` |
| `APP_URL` | Public base URL used in generated links (e.g. recurring-payment manage/cancel URLs) | `http://localhost:3000` | Yes in prod | `https://api.facilpay.com` |

## Auth

| Variable | Description | Default | Required | Example |
| --- | --- | --- | --- | --- |
| `JWT_SECRET` | Secret used to sign JWTs | *(placeholder)* | **Yes** | a long random string |
| `REFRESH_TOKEN_EXPIRY_DAYS` | Lifetime of refresh tokens in days | `30` | No | `30` |
| `TWO_FACTOR_ENCRYPTION_KEY` | Key used to encrypt 2FA secrets | *(placeholder)* | **Yes** | a long random string |
| `LOGIN_MAX_ATTEMPTS` | Failed login attempts before lockout | `5` | No | `5` |
| `LOGIN_LOCK_DURATION_MINUTES` | Minutes an account stays locked | `15` | No | `15` |

## Database

| Variable | Description | Default | Required | Example |
| --- | --- | --- | --- | --- |
| `DATABASE_HOST` | Postgres host | `localhost` | Yes | `db` |
| `DATABASE_PORT` | Postgres port | `5432` | Yes | `5432` |
| `DATABASE_USERNAME` | Postgres user | `postgres` | Yes | `facilpay` |
| `DATABASE_PASSWORD` | Postgres password | `password` | Yes | *(secret)* |
| `DATABASE_NAME` | Database name | `facilpay` | Yes | `facilpay` |
| `DATABASE_SYNCHRONIZE` | Auto-sync schema (dev only) | `true` | Set **`false`** in prod | `false` |
| `DATABASE_POOL_MIN` | Min connection pool size | `2` | No | `2` |
| `DATABASE_POOL_MAX` | Max connection pool size | `10` | No | `10` |
| `DATABASE_POOL_IDLE_TIMEOUT_MS` | Idle connection timeout (ms) | `30000` | No | `30000` |
| `DATABASE_POOL_CONNECTION_TIMEOUT_MS` | Connection acquisition timeout (ms) | `5000` | No | `5000` |
| `DATABASE_SLOW_QUERY_THRESHOLD_MS` | Slow-query log threshold (ms) | `500` | No | `500` |

## Logging

| Variable | Description | Default | Required | Example |
| --- | --- | --- | --- | --- |
| `LOG_LEVEL` | Pino log level | `debug` (dev), `info` (prod) | No | `info` |
| `LOG_DIR` | Directory for rotating log files | `logs` | No | `logs` |
| `LOG_PRETTY` | Pretty-print logs | `true` (dev), `false` (prod) | No | `false` |
| `LOG_MAX_SIZE` | Max size per log file | `10m` | No | `10m` |
| `LOG_RETENTION_DAYS` | Days to retain log files | `14` | No | `14` |
| `LOG_BODY` | Log request bodies | `false` | No | `false` |
| `LOG_BODY_MAX_LENGTH` | Max request body length logged | `2048` | No | `2048` |
| `LOG_RESPONSE_BODY` | Log response bodies | `false` | No | `false` |

## Stellar

| Variable | Description | Default | Required | Example |
| --- | --- | --- | --- | --- |
| `STELLAR_NETWORK` | Stellar network (`TESTNET` or `PUBLIC`) | `TESTNET` | Set **`PUBLIC`** in prod | `PUBLIC` |
| `STELLAR_HORIZON_URL` | Horizon endpoint | `https://horizon-testnet.stellar.org` | No | `https://horizon.stellar.org` |
| `STELLAR_BASE_FEE` | Base fee (stroops) | `100` | No | `100` |
| `STELLAR_SOURCE_SECRET` | Secret key of the platform distribution account | *(placeholder)* | **Yes** | `S...` |

## Email / SMTP

| Variable | Description | Default | Required | Example |
| --- | --- | --- | --- | --- |
| `SMTP_HOST` | SMTP server host | `smtp.ethereal.email` | Yes | `smtp.example.com` |
| `SMTP_PORT` | SMTP server port | `587` | No | `587` |
| `SMTP_SECURE` | Use TLS (`true`/`false`) | `false` | No | `true` |
| `SMTP_USER` | SMTP username | *(empty)* | Yes | `user` |
| `SMTP_PASS` | SMTP password | *(empty)* | Yes | *(secret)* |
| `SMTP_FROM` | From address for outgoing mail | `"FacilPay" <noreply@facilpay.com>` | No | `"FacilPay" <noreply@facilpay.com>` |

## CORS

| Variable | Description | Default | Required | Example |
| --- | --- | --- | --- | --- |
| `CORS_ALLOWED_ORIGINS` | Comma-separated allowed origins (empty disables CORS) | *(empty)* | No | `https://app.facilpay.com` |
| `CORS_ALLOW_CREDENTIALS` | Allow credentials (`"true"`/`"false"`) | `false` | No | `true` |

## Trusted reverse proxies

| Variable | Description | Default | Required | Example |
| --- | --- | --- | --- | --- |
| `TRUSTED_PROXY_IPS` | Comma-separated IPs/CIDRs allowed to set `X-Forwarded-For` | *(empty)* | No | `10.0.0.0/8` |

When empty, `X-Forwarded-For` is never trusted and the socket peer address is
used for IP allowlist / geo-restriction checks.

## Redis / Queues

| Variable | Description | Default | Required | Example |
| --- | --- | --- | --- | --- |
| `REDIS_HOST` | Redis host | `localhost` | Yes | `redis` |
| `REDIS_PORT` | Redis port | `6379` | No | `6379` |

## Rates & currencies

| Variable | Description | Default | Required | Example |
| --- | --- | --- | --- | --- |
| `SUPPORTED_CURRENCIES` | Comma-separated currency codes accepted by validation and currency endpoints | `USD,EUR,GBP` | No | `USD,EUR,GBP,NGN` |
| `FX_PROVIDER_URL` | FX rate provider used to populate `GET /v1/rates` | `https://api.exchangerate.host/latest` | No | `https://api.exchangerate.host/latest` |
| `FX_RATE_CACHE_TTL_SECONDS` | TTL for cached FX rates in Redis (seconds) | `60` | No | `60` |
| `GEO_LOOKUP_CACHE_TTL_SECONDS` | TTL for cached IP-to-country lookups (seconds) | `300` | No | `300` |

## Payments

| Variable | Description | Default | Required | Example |
| --- | --- | --- | --- | --- |
| `PAYMENT_DEFAULT_EXPIRY_SECONDS` | Seconds before a PENDING payment expires | `1800` | No | `1800` |
| `PAYMENT_MAX_REFUNDS_PER_PAYMENT` | Max refunds per payment | `20` | No | `20` |
| `RECURRING_PAYMENT_AUTO_PAUSE_FAILURES` | Consecutive failures before a recurring plan auto-pauses | `3` | No | `3` |
| `IDEMPOTENCY_TTL_HOURS` | Idempotency key time-to-live (hours) | `24` | No | `24` |

## Webhooks

| Variable | Description | Default | Required | Example |
| --- | --- | --- | --- | --- |
| `WEBHOOK_SECRET` | Secret used for HMAC webhook signature verification | *(placeholder)* | **Yes** | a long random string |

> The `SUPPORTED_CURRENCIES` variable is read by
> `src/modules/payments/currency-config.service.ts`; currencies not in
> `CURRENCY_METADATA` still pass validation but fall back to the code itself as
> their name/symbol.

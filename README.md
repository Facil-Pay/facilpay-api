# facilpay-api
Backend API service for FacilPay - Stellar-based multi-chain payment gateway. Handles payment processing, webhook management, settlement operations, and merchant integrations.

# FacilPay API

Backend API built with **NestJS**.

---

## 🚀 Requirements

- Docker and Docker Compose for the fastest local setup
- Node.js 18+ and npm for running without Docker

---

## Docker Quick Start

Start the API, PostgreSQL, and Redis with hot reload:

```bash
docker compose up --build
```

The API will be available at http://localhost:3000.

Run database migrations inside the API container:

```bash
docker compose run --rm api migrate
```

Run E2E tests against a throwaway PostgreSQL database:

```bash
docker compose -f docker-compose.test.yml run --rm api test:e2e
```

Stop and remove local containers, networks, and volumes:

```bash
docker compose down -v
```

## Local Setup

1. Install dependencies
```bash
npm install
```

2. Create environment file
```bash
cp .env.example .env
```

3. Run the application
```bash
npm run start:dev
```

The application will be available at:
http://localhost:3000

## Common Commands

```bash
npm run dev
npm test
npm run test:e2e
npm run migrate
npm run docker:dev
npm run docker:test:e2e
```

## 🩺 Health Check

All controllers are mounted under the `/v1` prefix. FacilPay exposes a lightweight liveness probe and a full readiness/subsystem check:

### Liveness probe (no outbound calls)
```bash
curl -i http://localhost:3000/v1/health/live
```

Expected Response (`200 OK`):
```json
{
  "status": "ok",
  "statusCode": 200,
  "timestamp": "2026-01-26T10:00:00.000Z",
  "uptime": 3600
}
```

### Readiness & full subsystem health check
```bash
curl -i http://localhost:3000/v1/health/ready
# or equivalently:
curl -i http://localhost:3000/v1/health
```

Expected Response (`200 OK` when `ok` or `degraded`, `503 Service Unavailable` when `unhealthy`):
```json
{
  "status": "ok",
  "statusCode": 200,
  "timestamp": "2026-01-26T10:00:00.000Z",
  "uptime": 3600,
  "services": {
    "database": {
      "status": "healthy",
      "message": "Database connection is healthy"
    },
    "stellar": {
      "status": "healthy",
      "message": "Stellar network is reachable"
    },
    "horizonStream": {
      "status": "connected",
      "message": "Horizon SSE stream is active"
    },
    "queue": {
      "status": "healthy",
      "message": "Redis connection is healthy"
    },
    "system": {
      "memory": {
        "used": 536870912,
        "total": 8589934592,
        "percentUsed": 6.25
      },
      "uptime": 3600
    }
  }
}
```

## 🔐 Authentication

The API includes a JWT-based authentication system under `/v1/auth` and `/v1/users`:

### Register a new user
```bash
curl -X POST http://localhost:3000/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com","password":"password123"}'
```

### Login user
```bash
curl -X POST http://localhost:3000/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com","password":"password123"}'
```

### Access current user profile (protected route)
```bash
curl -X GET http://localhost:3000/v1/users/me \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

## 📁 Project Structure

```text
src/
├── modules/
│   ├── auth/
│   │   ├── auth.controller.ts
│   │   ├── auth.service.ts
│   │   ├── auth.module.ts
│   │   ├── jwt.strategy.ts
│   │   ├── guards/
│   │   └── decorators/
│   ├── stellar/
│   │   ├── stellar.service.ts
│   │   └── stellar.module.ts
│   ├── users/
│   │   ├── user.entity.ts
│   │   ├── dto/
│   │   └── users.module.ts
│   └── health/
│       ├── health.controller.ts
│       ├── health.service.ts
│       └── health.module.ts
├── app.controller.ts
├── app.service.ts
├── app.module.ts
└── main.ts
```

## 🧪 Development

The server runs on port 3000 by default.

The port can be configured using the `PORT` variable in the `.env` file.

## 📊 Logging

Logging is structured with Pino and writes rotating files under the log directory.

Environment variables:

- `LOG_LEVEL` (default: `info` in production, `debug` in development)
- `LOG_DIR` (default: `logs`)
- `LOG_PRETTY` (default: `true` in development, `false` in production)
- `LOG_MAX_SIZE` (default: `10m`)
- `LOG_RETENTION_DAYS` (default: `14`)
- `LOG_BODY` (default: `false`)
- `LOG_BODY_MAX_LENGTH` (default: `2048`)
- `LOG_RESPONSE_BODY` (default: `false`)

## 🔒 Security Features

- JWT token-based authentication
- Password hashing with bcrypt
- Protected routes with guards
- Public route decorator
- Current user decorator
- Role-based access control

- Telegram: https://t.me/+afM9uh7GGtVkYmZk

## 📚 Further Documentation

- [Audit Log](docs/AUDIT_LOG.md) — audit trail events and querying
- [Disputes](docs/DISPUTES.md) — dispute lifecycle and resolution workflows
- [Environment](docs/ENVIRONMENT.md) — environment variable reference and configuration
- [Idempotency](docs/IDEMPOTENCY.md) — idempotency key handling for safe retries
- [Ledger](docs/LEDGER.md) — double-entry ledger architecture and balance tracking
- [Merchant Access Controls](docs/MERCHANT_ACCESS_CONTROLS.md) — IP allowlists and merchant security controls
- [Merchant Rate Limiting](docs/MERCHANT_RATE_LIMITING.md) — per-merchant rate limit tiers and headers
- [Password Reset](docs/PASSWORD_RESET.md) — password reset token flow
- [Payment Links](docs/PAYMENT_LINKS.md) — hosted payment link creation and checkout
- [Payment Splits](docs/PAYMENT_SPLITS.md) — multi-recipient payment split configuration
- [Rates](docs/RATES.md) — exchange rate quotes and slippage handling
- [RBAC](docs/RBAC.md) — role-based access control permissions and guards
- [Refunds](docs/REFUNDS.md) — full and partial refund processing
- [Sessions](docs/SESSIONS.md) — session listing and revocation
- [Settlements](docs/SETTLEMENTS.md) — merchant settlement batching and payouts
- [Stellar](docs/STELLAR.md) — Stellar Horizon integration and account monitoring
- [Two-Factor Authentication](docs/TWO_FACTOR_AUTH.md) — TOTP 2FA setup, verification, and recovery
- [Webhooks](docs/WEBHOOKS.md) — webhook delivery, signatures, and retry queues

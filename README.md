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

Start the API and PostgreSQL with hot reload:

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

## Create environment file
```bash
cp .env.example .env
```

## Run the application
```bash
npm run start:dev
```
 ## The application will be available at:
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

To verify the API is running correctly, use the liveness probe — it never fails due to an
external dependency and is safe for orchestrator restart checks:

```bash
curl -i http://localhost:3000/v1/health/live
```

Expected response (200 OK):

```json
{
  "status": "ok",
  "statusCode": 200,
  "timestamp": "2026-01-26T10:00:00.000Z",
  "uptime": 3600
}
```

To check whether all dependencies (database, Stellar, Redis) are ready:

```bash
curl -i http://localhost:3000/v1/health/ready
```

Trimmed example response (200 OK — all healthy):

```json
{
  "status": "ok",
  "statusCode": 200,
  "timestamp": "2026-01-26T10:00:00.000Z",
  "uptime": 3600,
  "services": {
    "database": { "status": "healthy", "message": "Database connection is healthy" },
    "stellar":  { "status": "healthy", "message": "Stellar network is reachable" },
    "queue":    { "status": "healthy", "message": "Redis connection is healthy" }
  }
}
```

See [docs/HEALTH_CHECKS.md](docs/HEALTH_CHECKS.md) for full probe semantics and deployment examples.

## 🔐 Authentication

The API includes a JWT-based authentication system with the following endpoints:

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

### Access protected route
```bash
curl -X GET http://localhost:3000/v1/users/me \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

## 📁 Project Structure

src/
├── modules/
│   ├── auth/
│   │   ├── auth.controller.ts
│   │   ├── auth.service.ts
│   │   ├── auth.module.ts
│   │   ├── jwt.strategy.ts
│   │   ├── guards/
│   │   └── decorators/
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

## 🧪 Development

The server runs on port 3000 by default.

The port can be configured using the PORT variable in the .env file

## 📊 Logging

Logging is structured with Pino and writes rotating files under the log directory.

Environment variables:

- LOG_LEVEL (default: info in production, debug in development)
- LOG_DIR (default: logs)
- LOG_PRETTY (default: true in development, false in production)
- LOG_MAX_SIZE (default: 10m)
- LOG_RETENTION_DAYS (default: 14)
- LOG_BODY (default: false)
- LOG_BODY_MAX_LENGTH (default: 2048)
- LOG_RESPONSE_BODY (default: false)

## 🔒 Security Features

- JWT token-based authentication
- Password hashing with bcrypt
- Protected routes with guards
- Public route decorator
- Current user decorator
- Role-based access control (ready for implementation)

- Telegram: https://t.me/+afM9uh7GGtVkYmZk

# Stellar Configuration structure
```
├── modules/
│   ├── auth/
│   ├── stellar/          <-- New Module
│   │   ├── stellar.service.ts
│   │   └── stellar.module.ts
│   ├── users/
│   └── health/

```

## 📚 Further Documentation

- [Contributing](CONTRIBUTING.md) — setup, conventions, PR checklist
- [Sessions](docs/SESSIONS.md) — session listing and revocation
- [Refunds](docs/REFUNDS.md) — refund system and maker-checker approval flow
- [Disputes](docs/DISPUTES.md) — dispute lifecycle and evidence uploads
- [Webhooks](docs/WEBHOOKS.md) — webhook endpoints and event types
- [Events](docs/EVENTS.md) — Events API, event object schema, filters, and pagination
- [RBAC](docs/RBAC.md) — role-based access control
- [Audit Log](docs/AUDIT_LOG.md) — audit logging
- [Settlements](docs/SETTLEMENTS.md) — settlement processing
- [Payment Splits](docs/PAYMENT_SPLITS.md) — payment splitting
- [Payment Links](docs/PAYMENT_LINKS.md) — payment link generation
- [Merchant Rate Limiting](docs/MERCHANT_RATE_LIMITING.md) — rate limiting
- [Merchant Access Controls](docs/MERCHANT_ACCESS_CONTROLS.md) — merchant ACL
- [Idempotency](docs/IDEMPOTENCY.md) — idempotency for safe retries
- [Ledger](docs/LEDGER.md) — ledger and accounting
- [Rates](docs/RATES.md) — currency rates and conversion
- [Stellar](docs/STELLAR.md) — Stellar network integration
- [Two-Factor Auth](docs/TWO_FACTOR_AUTH.md) — 2FA implementation
- [WebAuthn](docs/WEBAUTHN.md) — passkey registration and authentication
- [Password Reset](docs/PASSWORD_RESET.md) — password reset flow
- [Customers](docs/CUSTOMERS.md) — customer CRUD and payment history
- [Checkout Sessions](docs/CHECKOUT_SESSIONS.md) — hosted checkout sessions
- [Exports](docs/EXPORTS.md) — background export jobs
- [Notifications](docs/NOTIFICATIONS.md) — in-app notification centre and email preferences
- [Environment](docs/ENVIRONMENT.md) — environment variable reference

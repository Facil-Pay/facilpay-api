# Contributing to FacilPay API

Thank you for contributing. This guide explains how to set up the project, the
conventions we follow, and what CI will check on your pull request.

## Prerequisites

- **Node.js 18+** (CI uses Node 20)
- **npm**
- **Docker** and **Docker Compose** (for the Postgres database and e2e tests)
- A local Postgres instance (or the `docker-compose.yml` service)

## Local setup

1. Clone the repository and install dependencies:

   ```bash
   git clone https://github.com/Facil-Pay/facilpay-api.git
   cd facilpay-api
   npm install
   ```

2. Create your environment file from the example:

   ```bash
   cp .env.example .env
   ```

   See [`docs/ENVIRONMENT.md`](docs/ENVIRONMENT.md) for the full list of
   variables and which ones must change in production.

3. Start Postgres (or bring up the whole stack with Docker):

   ```bash
   docker compose up -d
   ```

4. Run database migrations:

   ```bash
   npm run typeorm -- migration:run
   ```

5. Start the API in development mode:

   ```bash
   npm run start:dev
   ```

The server listens on port `3000` by default (override with `PORT`).

## Checks before you push

CI runs exactly these jobs (see `.github/workflows/ci.yml`). Run them locally
before opening a PR:

| Command | What it checks |
| --- | --- |
| `npm run lint` | ESLint |
| `npm run build` | TypeScript compilation |
| `npm test` | Unit tests (Jest) |
| `npm run test:e2e` | End-to-end tests (via Docker Compose) |

The e2e suite runs through `docker compose -f docker-compose.test.yml run --rm api test:e2e`.

## Branch naming

Name your branch after the work it does:

```
feat/<issue>-short-name
fix/<issue>-short-name
docs/<issue>-short-name
```

For example: `feat/123-recurring-payment-retry`, `fix/456-login-lockout`.

## Commit messages

Use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add recurring payment retry
fix: correct session expiry on logout
docs: document error response format
test: cover auto-pause threshold
ci: cache npm dependencies
```

Keep the subject line under 72 characters and use the imperative mood
("add", not "added" or "adds").

## Adding a TypeORM migration

When you change an entity, generate a migration:

```bash
npm run typeorm -- migration:generate src/migrations/NameOfMigration
```

Review the generated SQL, then run it against your local database to verify:

```bash
npm run typeorm -- migration:run
```

## Pull request checklist

Before requesting review, confirm all of the following:

- [ ] Tests added or updated for the change (`npm test` passes)
- [ ] Documentation updated if the change affects public behavior
- [ ] A migration is included for any entity/schema change
- [ ] Swagger decorators (`@ApiOperation`, `@ApiProperty`, ...) added for any new or changed endpoint
- [ ] `npm run lint` and `npm run build` pass
- [ ] Commit messages follow Conventional Commits

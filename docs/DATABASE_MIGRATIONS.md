# Database Migrations

This project uses [TypeORM](https://typeorm.io/) migrations to evolve the PostgreSQL schema. Migrations live in `src/migrations/` and are wired up through `src/data-source.ts`.

## Prerequisites

- A running PostgreSQL instance (local or via Docker Compose).
- Environment variables from `.env` (`DATABASE_HOST`, `DATABASE_PORT`, `DATABASE_USERNAME`, `DATABASE_PASSWORD`, `DATABASE_NAME`). See `src/data-source.ts` for the defaults.

## Available commands

All commands are defined in `package.json` and use the TypeORM CLI against `src/data-source.ts`.

| Purpose | npm | Docker |
| --- | --- | --- |
| Run pending migrations | `npm run migrate` | `docker compose exec app npm run migrate` |
| Revert the last migration | `npm run migrate:revert` | `docker compose exec app npm run migrate:revert` |
| Raw TypeORM CLI | `npm run typeorm -- <args>` | `docker compose exec app npm run typeorm -- <args>` |

Examples:

```bash
# Create a new empty migration file
npm run typeorm -- migration:create src/migrations/<timestamp>-<name>

# Generate a migration by diffing entities against the current schema
npm run typeorm -- migration:generate src/migrations/<timestamp>-<name>

# Show migration status
npm run typeorm -- migration:show

# Run / revert
npm run migrate
npm run migrate:revert
```

Docker equivalents simply prefix the command with `docker compose exec app`:

```bash
docker compose exec app npm run typeorm -- migration:show
docker compose exec app npm run migrate
docker compose exec app npm run migrate:revert
```

## Naming and timestamp convention

Migration files must follow:

```
<timestamp>-<kebab-case-description>.ts
```

- `<timestamp>` is a **13-digit Unix epoch in milliseconds** (e.g. `1754500000000`).
- `<description>` is a short, kebab-case summary of the change (e.g. `add-index-to-payments`).
- **Timestamps must be unique across the whole `src/migrations/` directory.** TypeORM orders migrations by timestamp, so duplicates make the run order ambiguous and can cause migrations to be skipped or applied out of order.

Generate the timestamp with:

```bash
date +%s%3N
```

Before committing, verify uniqueness:

```bash
ls src/migrations | cut -d- -f1 | sort | uniq -d
```

This command should print nothing. If it prints a timestamp, rename the newer file to a fresh, larger timestamp.

## Existing placeholder files

`src/migrations/` currently contains files with clashing timestamps (several `1754500000000-*`) and placeholder names (`XXXXXXXXXXXXXX-*.ts`). These must be cleaned up:

1. Rename each placeholder (`XXXXXXXXXXXXXX-*.ts`) to a real, unique timestamp and a descriptive name.
2. Resolve the `1754500000000-*` collisions by giving each file a distinct, increasing timestamp that reflects the intended order.
3. Update the `name` property inside each migration class if it references the old timestamp.
4. Run `npm run typeorm -- migration:show` to confirm the ordering is correct before merging.

## Data migrations and backfills

Schema changes and data changes should be handled carefully:

- **Keep schema and data changes in separate migrations** when practical. This makes reverts safer and easier to reason about.
- **Backfills must be idempotent.** Use `WHERE` clauses that only touch rows needing the change, so re-running is safe.
- **Batch large backfills.** Avoid locking large tables in a single statement; process in chunks (e.g. by `id` ranges) inside the migration.
- **Always implement `down()`.** For data migrations, `down()` should reverse the change where feasible, or be a documented no-op if the data cannot be restored.
- **Do not rely on application code** (entities, services) inside migrations. Use the `queryRunner` / raw SQL so migrations remain stable as the codebase evolves.
- **Test on a copy of production-like data** before running a backfill against real data.

Example data migration skeleton:

```ts
import { MigrationInterface, QueryRunner } from 'typeorm';

export class BackfillExample1754500000000 implements MigrationInterface {
  name = 'BackfillExample1754500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "payments" SET "status" = 'pending' WHERE "status" IS NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Intentionally a no-op: the previous NULL state cannot be restored.
  }
}
```

## Workflow summary

1. Update entities in `src/`.
2. Generate or create a migration with a unique timestamp and descriptive name.
3. Review the generated SQL; adjust for safety (idempotency, batching, `down()`).
4. Run `npm run migrate` locally and verify.
5. Commit the migration alongside the entity changes.
6. In CI/deploy, run `npm run migrate` before starting the app.

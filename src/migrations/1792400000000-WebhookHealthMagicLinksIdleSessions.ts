import { MigrationInterface, QueryRunner } from 'typeorm';

export class WebhookHealthMagicLinksIdleSessions1792400000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE webhook_endpoints ADD COLUMN headers jsonb NULL`);
    await queryRunner.query(`ALTER TABLE webhook_deliveries ADD COLUMN "latencyMs" integer NULL`);
    await queryRunner.query(`CREATE INDEX "idx_webhook_delivery_stats" ON webhook_deliveries ("endpointId", "lastAttemptAt")`);
    await queryRunner.query(`ALTER TABLE merchant_settings ADD COLUMN "idleSessionTimeoutMinutes" integer NULL CHECK ("idleSessionTimeoutMinutes" BETWEEN 1 AND 43200)`);
    await queryRunner.query(`ALTER TABLE sessions ADD COLUMN "lastSeenAt" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP`);
    await queryRunner.query(`UPDATE sessions SET "lastSeenAt" = "lastActiveAt"`);
    await queryRunner.query(`CREATE TABLE magic_link_tokens (
      id uuid PRIMARY KEY DEFAULT uuid_generate_v4(), "userId" uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      "tokenHash" varchar(64) NOT NULL UNIQUE, "expiresAt" timestamptz NOT NULL,
      used boolean NOT NULL DEFAULT false, "createdAt" timestamp NOT NULL DEFAULT now()
    )`);
    await queryRunner.query(`CREATE INDEX idx_magic_link_expiry ON magic_link_tokens ("expiresAt")`);
    await queryRunner.query(`CREATE TABLE magic_link_rate_limits (key varchar(64) PRIMARY KEY, count integer NOT NULL, "expiresAt" timestamptz NOT NULL)`);
  }
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE magic_link_rate_limits');
    await queryRunner.query('DROP TABLE magic_link_tokens');
    await queryRunner.query('ALTER TABLE sessions DROP COLUMN "lastSeenAt"');
    await queryRunner.query('ALTER TABLE merchant_settings DROP COLUMN "idleSessionTimeoutMinutes"');
    await queryRunner.query('DROP INDEX "idx_webhook_delivery_stats"');
    await queryRunner.query('ALTER TABLE webhook_deliveries DROP COLUMN "latencyMs"');
    await queryRunner.query('ALTER TABLE webhook_endpoints DROP COLUMN headers');
  }
}

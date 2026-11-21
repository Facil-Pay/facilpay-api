import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAnchorTables1792900000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── anchor_configs ────────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE "anchor_configs" (
        "id"              uuid          NOT NULL DEFAULT uuid_generate_v4(),
        "merchantId"      varchar(255)  NOT NULL,
        "homeDomain"      varchar(253)  NOT NULL,
        "supportedAssets" text[]        NOT NULL DEFAULT '{}',
        "isActive"        boolean       NOT NULL DEFAULT true,
        "createdAt"       timestamptz   NOT NULL DEFAULT now(),
        "updatedAt"       timestamptz   NOT NULL DEFAULT now(),
        CONSTRAINT "PK_anchor_configs" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_anchor_configs_merchant_domain"
       ON "anchor_configs" ("merchantId", "homeDomain")`,
    );

    await queryRunner.query(
      `CREATE INDEX "IDX_anchor_configs_merchantId"
       ON "anchor_configs" ("merchantId")`,
    );

    // ── anchor_withdrawal_status enum ────────────────────────────────────────
    await queryRunner.query(`
      CREATE TYPE "anchor_withdrawals_status_enum" AS ENUM (
        'PENDING_USER',
        'PENDING_ANCHOR',
        'PENDING_STELLAR',
        'COMPLETED',
        'FAILED',
        'CANCELLED'
      )
    `);

    // ── anchor_withdrawals ────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE "anchor_withdrawals" (
        "id"                    uuid          NOT NULL DEFAULT uuid_generate_v4(),
        "merchantId"            varchar(255)  NOT NULL,
        "anchorConfigId"        uuid          NOT NULL,
        "anchorTransactionId"   varchar(128)  NOT NULL,
        "assetCode"             varchar(12)   NOT NULL,
        "amount"                decimal(20,7) NOT NULL,
        "status"                "anchor_withdrawals_status_enum"
                                              NOT NULL DEFAULT 'PENDING_USER',
        "interactiveUrl"        text,
        "withdrawAnchorAccount" varchar(128),
        "withdrawMemo"          varchar(64),
        "withdrawMemoType"      varchar(10),
        "stellarTransactionHash" varchar(128),
        "failureReason"         text,
        "createdAt"             timestamptz   NOT NULL DEFAULT now(),
        "updatedAt"             timestamptz   NOT NULL DEFAULT now(),
        CONSTRAINT "PK_anchor_withdrawals" PRIMARY KEY ("id"),
        CONSTRAINT "FK_anchor_withdrawals_config"
          FOREIGN KEY ("anchorConfigId") REFERENCES "anchor_configs"("id")
          ON DELETE RESTRICT
      )
    `);

    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_anchor_withdrawals_anchorTxId"
       ON "anchor_withdrawals" ("anchorTransactionId")`,
    );

    await queryRunner.query(
      `CREATE INDEX "IDX_anchor_withdrawals_merchantId"
       ON "anchor_withdrawals" ("merchantId")`,
    );

    await queryRunner.query(
      `CREATE INDEX "IDX_anchor_withdrawals_merchant_createdAt"
       ON "anchor_withdrawals" ("merchantId", "createdAt" DESC)`,
    );

    await queryRunner.query(
      `CREATE INDEX "IDX_anchor_withdrawals_status"
       ON "anchor_withdrawals" ("status")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_anchor_withdrawals_status"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_anchor_withdrawals_merchant_createdAt"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_anchor_withdrawals_merchantId"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_anchor_withdrawals_anchorTxId"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "anchor_withdrawals"`);
    await queryRunner.query(
      `DROP TYPE IF EXISTS "anchor_withdrawals_status_enum"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_anchor_configs_merchantId"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_anchor_configs_merchant_domain"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "anchor_configs"`);
  }
}

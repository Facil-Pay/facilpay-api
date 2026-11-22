import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateUnmatchedTransactionsTable1792800000000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "unmatched_transactions_status_enum" AS ENUM (
        'PENDING',
        'MATCHED',
        'REFUNDED'
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "unmatched_transactions" (
        "id"               uuid          NOT NULL DEFAULT uuid_generate_v4(),
        "transactionHash"  varchar(128)  NOT NULL,
        "fromAddress"      varchar(128)  NOT NULL,
        "amount"           decimal(20,7) NOT NULL,
        "assetCode"        varchar(12)   NOT NULL,
        "memo"             varchar(256),
        "status"           "unmatched_transactions_status_enum"
                                         NOT NULL DEFAULT 'PENDING',
        "matchedPaymentId" uuid,
        "resolvedBy"       varchar(255),
        "resolvedAt"       timestamptz,
        "createdAt"        timestamptz   NOT NULL DEFAULT now(),
        "updatedAt"        timestamptz   NOT NULL DEFAULT now(),
        CONSTRAINT "PK_unmatched_transactions" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_unmatched_transactions_txHash"
       ON "unmatched_transactions" ("transactionHash")`,
    );

    await queryRunner.query(
      `CREATE INDEX "IDX_unmatched_transactions_status"
       ON "unmatched_transactions" ("status")`,
    );

    await queryRunner.query(
      `CREATE INDEX "IDX_unmatched_transactions_matchedPaymentId"
       ON "unmatched_transactions" ("matchedPaymentId")`,
    );

    await queryRunner.query(
      `CREATE INDEX "IDX_unmatched_transactions_createdAt"
       ON "unmatched_transactions" ("createdAt" DESC)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_unmatched_transactions_createdAt"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_unmatched_transactions_matchedPaymentId"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_unmatched_transactions_status"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_unmatched_transactions_txHash"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "unmatched_transactions"`);
    await queryRunner.query(
      `DROP TYPE IF EXISTS "unmatched_transactions_status_enum"`,
    );
  }
}

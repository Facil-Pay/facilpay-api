import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Creates the payment_verification_logs table used by the
 * POST /v1/payments/:id/verify-transaction endpoint to record every
 * verification attempt for audit and support purposes.
 */
export class CreatePaymentVerificationLogsTable1793000000000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "payment_verification_logs" (
        "id"                uuid          NOT NULL DEFAULT uuid_generate_v4(),
        "paymentId"         uuid          NOT NULL,
        "transactionHash"   varchar(128)  NOT NULL,
        "matched"           boolean       NOT NULL,
        "mismatches"        jsonb         NOT NULL DEFAULT '[]',
        "paymentCompleted"  boolean       NOT NULL DEFAULT false,
        "requestedBy"       varchar(255),
        "createdAt"         timestamptz   NOT NULL DEFAULT now(),
        CONSTRAINT "PK_payment_verification_logs" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(
      `CREATE INDEX "IDX_pvl_paymentId"
       ON "payment_verification_logs" ("paymentId")`,
    );

    await queryRunner.query(
      `CREATE INDEX "IDX_pvl_transactionHash"
       ON "payment_verification_logs" ("transactionHash")`,
    );

    await queryRunner.query(
      `CREATE INDEX "IDX_pvl_createdAt"
       ON "payment_verification_logs" ("createdAt" DESC)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_pvl_createdAt"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_pvl_transactionHash"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_pvl_paymentId"`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS "payment_verification_logs"`,
    );
  }
}

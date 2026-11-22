import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateSep31ReceivingTables1793200000000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "sep31_customers" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "senderAccount" varchar(56) NOT NULL,
        "type" varchar(16) NOT NULL,
        "merchantId" uuid,
        "status" varchar(32) NOT NULL DEFAULT 'NEEDS_INFO',
        "encryptedFields" text,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_sep31_customers" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_sep31_customers_type"
          CHECK ("type" IN ('sender', 'receiver'))
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_sep31_customers_sender_type"
      ON "sep31_customers" ("senderAccount", "type")
    `);

    await queryRunner.query(`
      CREATE TABLE "sep31_transactions" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "paymentId" uuid NOT NULL,
        "merchantId" uuid NOT NULL,
        "senderId" uuid NOT NULL,
        "receiverId" uuid NOT NULL,
        "senderAccount" varchar(56) NOT NULL,
        "assetCode" varchar(12) NOT NULL,
        "assetIssuer" varchar(56),
        "amount" decimal(20,7) NOT NULL,
        "stellarMemo" varchar(64) NOT NULL,
        "stellarAccountId" varchar(56) NOT NULL,
        "status" varchar(32) NOT NULL DEFAULT 'pending_sender',
        "startedAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_sep31_transactions" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_sep31_transactions_paymentId" UNIQUE ("paymentId"),
        CONSTRAINT "UQ_sep31_transactions_stellarMemo" UNIQUE ("stellarMemo"),
        CONSTRAINT "CHK_sep31_transactions_amount" CHECK ("amount" > 0),
        CONSTRAINT "CHK_sep31_transactions_status"
          CHECK ("status" IN ('pending_sender', 'pending_receiver', 'completed', 'error'))
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_sep31_transactions_sender"
      ON "sep31_transactions" ("senderAccount", "startedAt")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_sep31_transactions_merchant"
      ON "sep31_transactions" ("merchantId", "startedAt")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_sep31_transactions_merchant"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_sep31_transactions_sender"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "sep31_transactions"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_sep31_customers_sender_type"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "sep31_customers"`);
  }
}

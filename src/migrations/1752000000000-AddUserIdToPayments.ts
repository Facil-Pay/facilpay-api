import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUserIdToPayments1752000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "userId" uuid NULL`,
    );

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_payments_user_id" ON "payments" ("userId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_payments_user_id"`,
    );

    await queryRunner.query(
      `ALTER TABLE "payments" DROP COLUMN IF EXISTS "userId"`,
    );
  }
}

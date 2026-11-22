import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateMerchantAccountMappings1793100000000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "merchant_account_mappings" (
        "merchantId" uuid NOT NULL,
        "mappings" jsonb NOT NULL,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_merchant_account_mappings" PRIMARY KEY ("merchantId")
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'DROP TABLE IF EXISTS "merchant_account_mappings"',
    );
  }
}

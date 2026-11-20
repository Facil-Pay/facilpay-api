import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSettlementAssetConversion1792800000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "merchant_settlement_configs" ADD COLUMN "settlementAsset" varchar(64) NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "merchant_settlement_configs" ADD COLUMN "maxSlippagePercent" decimal(5,2) NOT NULL DEFAULT 0.5`,
    );

    await queryRunner.query(
      `ALTER TABLE "settlements" ADD COLUMN "settlementAsset" varchar(64) NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "settlements" ADD COLUMN "sourceAsset" varchar(255) NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "settlements" ADD COLUMN "sourceAmount" decimal(20,7) NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "settlements" ADD COLUMN "destAmount" decimal(20,7) NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "settlements" ADD COLUMN "conversionRate" decimal(20,8) NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "settlements" ADD COLUMN "slippagePercent" decimal(10,6) NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "settlements" ADD COLUMN "conversionFee" decimal(20,7) NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "settlements" ADD COLUMN "conversionTransactionHash" varchar(64) NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "settlements" DROP COLUMN "conversionTransactionHash"`,
    );
    await queryRunner.query(
      `ALTER TABLE "settlements" DROP COLUMN "conversionFee"`,
    );
    await queryRunner.query(
      `ALTER TABLE "settlements" DROP COLUMN "slippagePercent"`,
    );
    await queryRunner.query(
      `ALTER TABLE "settlements" DROP COLUMN "conversionRate"`,
    );
    await queryRunner.query(
      `ALTER TABLE "settlements" DROP COLUMN "destAmount"`,
    );
    await queryRunner.query(
      `ALTER TABLE "settlements" DROP COLUMN "sourceAmount"`,
    );
    await queryRunner.query(
      `ALTER TABLE "settlements" DROP COLUMN "sourceAsset"`,
    );
    await queryRunner.query(
      `ALTER TABLE "settlements" DROP COLUMN "settlementAsset"`,
    );

    await queryRunner.query(
      `ALTER TABLE "merchant_settlement_configs" DROP COLUMN "maxSlippagePercent"`,
    );
    await queryRunner.query(
      `ALTER TABLE "merchant_settlement_configs" DROP COLUMN "settlementAsset"`,
    );
  }
}

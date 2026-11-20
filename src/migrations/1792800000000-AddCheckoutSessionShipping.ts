import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCheckoutSessionShipping1792800000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE checkout_sessions ADD COLUMN "shippingAddressCollection" jsonb NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE checkout_sessions ADD COLUMN "shippingOptions" jsonb NOT NULL DEFAULT '[]'`,
    );
    await queryRunner.query(
      `ALTER TABLE checkout_sessions ADD COLUMN "shippingAddress" jsonb NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE checkout_sessions ADD COLUMN "shippingOptionId" varchar(64) NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE checkout_sessions ADD COLUMN "shippingAmount" decimal(10,2) NOT NULL DEFAULT 0`,
    );
    await queryRunner.query(
      `ALTER TABLE customers ADD COLUMN "shippingAddress" jsonb NULL`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE customers DROP COLUMN "shippingAddress"`,
    );
    await queryRunner.query(
      `ALTER TABLE checkout_sessions DROP COLUMN "shippingAmount"`,
    );
    await queryRunner.query(
      `ALTER TABLE checkout_sessions DROP COLUMN "shippingOptionId"`,
    );
    await queryRunner.query(
      `ALTER TABLE checkout_sessions DROP COLUMN "shippingAddress"`,
    );
    await queryRunner.query(
      `ALTER TABLE checkout_sessions DROP COLUMN "shippingOptions"`,
    );
    await queryRunner.query(
      `ALTER TABLE checkout_sessions DROP COLUMN "shippingAddressCollection"`,
    );
  }
}

import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCheckoutSessionCoupons1792500000001 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE checkout_sessions ADD COLUMN subtotal decimal(10,2) NULL`);
    await queryRunner.query(`ALTER TABLE checkout_sessions ADD COLUMN "discountAmount" decimal(10,2) NOT NULL DEFAULT 0`);
    await queryRunner.query(`ALTER TABLE checkout_sessions ADD COLUMN "couponId" uuid NULL REFERENCES coupons(id) ON DELETE SET NULL`);
    await queryRunner.query(`ALTER TABLE checkout_sessions ADD COLUMN "couponCode" varchar(64) NULL`);
    await queryRunner.query(`UPDATE checkout_sessions SET subtotal = total`);
  }
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE checkout_sessions DROP COLUMN "couponCode"');
    await queryRunner.query('ALTER TABLE checkout_sessions DROP COLUMN "couponId"');
    await queryRunner.query('ALTER TABLE checkout_sessions DROP COLUMN "discountAmount"');
    await queryRunner.query('ALTER TABLE checkout_sessions DROP COLUMN subtotal');
  }
}

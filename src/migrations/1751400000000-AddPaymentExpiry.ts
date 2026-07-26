import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddPaymentExpiry1751400000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumns('payments', [
      new TableColumn({
        name: 'expiresAt',
        type: 'timestamp',
        isNullable: true,
      }),
      new TableColumn({
        name: 'expiredAt',
        type: 'timestamp',
        isNullable: true,
      }),
    ]);

    await queryRunner.query(
      `ALTER TYPE "payments_status_enum" ADD VALUE 'EXPIRED'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn('payments', 'expiredAt');
    await queryRunner.dropColumn('payments', 'expiresAt');
    // Note: PostgreSQL doesn't support removing enum values easily
  }
}

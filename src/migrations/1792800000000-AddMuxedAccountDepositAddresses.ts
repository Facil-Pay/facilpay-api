import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddMuxedAccountDepositAddresses1792800000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumns('payments', [
      new TableColumn({
        name: 'depositAddress',
        type: 'varchar',
        length: '69',
        isNullable: true,
      }),
      new TableColumn({
        name: 'muxedId',
        type: 'varchar',
        length: '20',
        isNullable: true,
      }),
    ]);

    await queryRunner.query(
      `CREATE INDEX "IDX_payments_depositAddress" ON "payments" ("depositAddress")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_payments_muxedId" ON "payments" ("muxedId")`,
    );

    await queryRunner.addColumn(
      'merchant_settings',
      new TableColumn({
        name: 'muxedAccountsEnabled',
        type: 'boolean',
        default: false,
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_payments_muxedId"`);
    await queryRunner.query(`DROP INDEX "IDX_payments_depositAddress"`);
    await queryRunner.dropColumns('payments', ['depositAddress', 'muxedId']);
    await queryRunner.dropColumn('merchant_settings', 'muxedAccountsEnabled');
  }
}

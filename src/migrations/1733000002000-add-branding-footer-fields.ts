import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddBrandingFooterFields1733000002000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn(
      'merchant_branding',
      new TableColumn({
        name: 'receiptFooter',
        type: 'text',
        isNullable: true,
      }),
    );

    await queryRunner.addColumn(
      'merchant_branding',
      new TableColumn({
        name: 'invoiceFooter',
        type: 'text',
        isNullable: true,
      }),
    );

    await queryRunner.addColumn(
      'merchant_branding',
      new TableColumn({
        name: 'taxId',
        type: 'varchar',
        length: '100',
        isNullable: true,
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn('merchant_branding', 'taxId');
    await queryRunner.dropColumn('merchant_branding', 'invoiceFooter');
    await queryRunner.dropColumn('merchant_branding', 'receiptFooter');
  }
}

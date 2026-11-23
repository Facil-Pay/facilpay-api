import { MigrationInterface, QueryRunner, Table, TableColumn } from 'typeorm';

export class AddInvoiceNumberingSettings1733000001000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add invoice numbering columns to merchant_settings
    await queryRunner.addColumn(
      'merchant_settings',
      new TableColumn({
        name: 'invoicePrefix',
        type: 'varchar',
        length: '20',
        isNullable: true,
      }),
    );

    await queryRunner.addColumn(
      'merchant_settings',
      new TableColumn({
        name: 'invoiceNumberPadding',
        type: 'int',
        default: 6,
      }),
    );

    await queryRunner.addColumn(
      'merchant_settings',
      new TableColumn({
        name: 'resetSequence',
        type: 'varchar',
        length: '10',
        default: "'never'",
      }),
    );

    // Create invoice_sequences table
    await queryRunner.createTable(
      new Table({
        name: 'invoice_sequences',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          {
            name: 'merchantId',
            type: 'uuid',
          },
          {
            name: 'year',
            type: 'int',
            isNullable: true,
          },
          {
            name: 'lastNumber',
            type: 'int',
            default: 0,
          },
          {
            name: 'createdAt',
            type: 'timestamptz',
            default: 'now()',
          },
          {
            name: 'updatedAt',
            type: 'timestamptz',
            default: 'now()',
          },
        ],
        indices: [
          {
            name: 'idx_invoice_sequences_merchant_year',
            columnNames: ['merchantId', 'year'],
            isUnique: true,
          },
        ],
      }),
      true,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('invoice_sequences');
    await queryRunner.dropColumn('merchant_settings', 'resetSequence');
    await queryRunner.dropColumn('merchant_settings', 'invoiceNumberPadding');
    await queryRunner.dropColumn('merchant_settings', 'invoicePrefix');
  }
}

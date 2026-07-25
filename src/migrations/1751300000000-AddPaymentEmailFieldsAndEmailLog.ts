import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

export class AddPaymentEmailFieldsAndEmailLog1751300000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TYPE email_log_status AS ENUM ('sent', 'failed')`);
    await queryRunner.query(`CREATE TYPE email_event_type AS ENUM (
      'payment_received',
      'payment_confirmed',
      'refund_issued',
      'refund_processed',
      'dispute_opened'
    )`);

    await queryRunner.query(`
      ALTER TABLE payments
      ADD COLUMN IF NOT EXISTS "merchantId" uuid,
      ADD COLUMN IF NOT EXISTS "merchantEmail" varchar(255),
      ADD COLUMN IF NOT EXISTS "payerEmail" varchar(255)
    `);

    await queryRunner.createIndex(
      'payments',
      new TableIndex({ name: 'IDX_payments_merchantId', columnNames: ['merchantId'] }),
    );

    await queryRunner.createTable(
      new Table({
        name: 'email_logs',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          { name: 'eventType', type: 'email_event_type', isNullable: false },
          { name: 'recipientEmail', type: 'varchar', length: '255', isNullable: false },
          { name: 'recipientRole', type: 'varchar', length: '50', isNullable: false },
          { name: 'subject', type: 'varchar', length: '255', isNullable: false },
          { name: 'status', type: 'email_log_status', default: `'sent'` },
          { name: 'errorMessage', type: 'text', isNullable: true },
          { name: 'paymentId', type: 'uuid', isNullable: true },
          { name: 'refundId', type: 'uuid', isNullable: true },
          { name: 'sentAt', type: 'timestamp', default: 'now()' },
        ],
      }),
      true,
    );

    await queryRunner.createIndex(
      'email_logs',
      new TableIndex({ name: 'IDX_email_logs_eventType', columnNames: ['eventType'] }),
    );
    await queryRunner.createIndex(
      'email_logs',
      new TableIndex({ name: 'IDX_email_logs_recipientEmail', columnNames: ['recipientEmail'] }),
    );
    await queryRunner.createIndex(
      'email_logs',
      new TableIndex({ name: 'IDX_email_logs_paymentId', columnNames: ['paymentId'] }),
    );
    await queryRunner.createIndex(
      'email_logs',
      new TableIndex({ name: 'IDX_email_logs_sentAt', columnNames: ['sentAt'] }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('email_logs');
    await queryRunner.query(`DROP TYPE IF EXISTS email_log_status`);
    await queryRunner.query(`DROP TYPE IF EXISTS email_event_type`);

    await queryRunner.dropIndex('payments', 'IDX_payments_merchantId');
    await queryRunner.query(`
      ALTER TABLE payments
      DROP COLUMN IF EXISTS "merchantId",
      DROP COLUMN IF EXISTS "merchantEmail",
      DROP COLUMN IF EXISTS "payerEmail"
    `);
  }
}

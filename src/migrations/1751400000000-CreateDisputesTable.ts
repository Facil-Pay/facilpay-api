import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

export class CreateDisputesTable1751400000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create dispute status enum
    await queryRunner.query(`CREATE TYPE dispute_status AS ENUM ('open', 'under_review', 'resolved', 'closed')`);

    // Create dispute reason enum
    await queryRunner.query(`CREATE TYPE dispute_reason AS ENUM (
      'fraud',
      'duplicate',
      'product_not_received',
      'product_not_as_described',
      'unauthorized',
      'other'
    )`);

    // Create disputes table
    await queryRunner.createTable(
      new Table({
        name: 'disputes',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          {
            name: 'paymentId',
            type: 'uuid',
            isNullable: false,
          },
          {
            name: 'status',
            type: 'dispute_status',
            default: "'open'",
            isNullable: false,
          },
          {
            name: 'reason',
            type: 'dispute_reason',
            isNullable: false,
          },
          {
            name: 'description',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'disputedAmount',
            type: 'decimal',
            precision: 10,
            scale: 2,
            isNullable: true,
          },
          {
            name: 'openedBy',
            type: 'varchar',
            length: '255',
            isNullable: true,
          },
          {
            name: 'resolutionNotes',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'resolvedBy',
            type: 'varchar',
            length: '255',
            isNullable: true,
          },
          {
            name: 'merchantEmail',
            type: 'varchar',
            length: '255',
            isNullable: true,
          },
          {
            name: 'payerEmail',
            type: 'varchar',
            length: '255',
            isNullable: true,
          },
          {
            name: 'createdAt',
            type: 'timestamp',
            default: 'now()',
            isNullable: false,
          },
          {
            name: 'updatedAt',
            type: 'timestamp',
            default: 'now()',
            isNullable: false,
          },
          {
            name: 'resolvedAt',
            type: 'timestamp',
            isNullable: true,
          },
          {
            name: 'closedAt',
            type: 'timestamp',
            isNullable: true,
          },
        ],
      }),
      true,
    );

    // Create indexes
    await queryRunner.createIndex(
      'disputes',
      new TableIndex({ name: 'IDX_disputes_paymentId', columnNames: ['paymentId'] }),
    );

    await queryRunner.createIndex(
      'disputes',
      new TableIndex({ name: 'IDX_disputes_status', columnNames: ['status'] }),
    );

    await queryRunner.createIndex(
      'disputes',
      new TableIndex({ name: 'IDX_disputes_createdAt', columnNames: ['createdAt'] }),
    );

    // Add foreign key constraint
    await queryRunner.query(`
      ALTER TABLE disputes
      ADD CONSTRAINT FK_disputes_payment
      FOREIGN KEY ("paymentId")
      REFERENCES payments(id)
      ON DELETE CASCADE
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop foreign key constraint
    await queryRunner.query(`ALTER TABLE disputes DROP CONSTRAINT IF EXISTS "FK_disputes_payment"`);

    // Drop indexes
    await queryRunner.dropIndex('disputes', 'IDX_disputes_createdAt');
    await queryRunner.dropIndex('disputes', 'IDX_disputes_status');
    await queryRunner.dropIndex('disputes', 'IDX_disputes_paymentId');

    // Drop table
    await queryRunner.dropTable('disputes');

    // Drop enums
    await queryRunner.query(`DROP TYPE IF EXISTS dispute_reason`);
    await queryRunner.query(`DROP TYPE IF EXISTS dispute_status`);
  }
}
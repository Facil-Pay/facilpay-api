import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUncollectibleStatusToInvoices1732291300000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add UNCOLLECTIBLE to the status enum
    await queryRunner.query(`
      ALTER TYPE "invoices_status_enum" ADD VALUE IF NOT EXISTS 'UNCOLLECTIBLE'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Note: PostgreSQL does not support removing enum values directly.
    // To revert, you would need to:
    // 1. Update all UNCOLLECTIBLE invoices to another status
    // 2. Create a new enum without UNCOLLECTIBLE
    // 3. Alter the column to use the new enum
    // 4. Drop the old enum
    // This is a complex operation, so we log a warning instead
    await queryRunner.query(`
      -- Reverting UNCOLLECTIBLE status requires manual intervention
      -- Update any UNCOLLECTIBLE invoices to VOID before running:
      -- UPDATE invoices SET status = 'VOID' WHERE status = 'UNCOLLECTIBLE';
      SELECT 1;
    `);
  }
}

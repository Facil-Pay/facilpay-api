import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('invoice_sequences')
@Index('idx_invoice_sequences_merchant_year', ['merchantId', 'year'], { unique: true })
export class InvoiceSequence {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  merchantId: string;

  @Column({ type: 'int', nullable: true })
  year: number | null;

  @Column({ type: 'int', default: 0 })
  lastNumber: number;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}

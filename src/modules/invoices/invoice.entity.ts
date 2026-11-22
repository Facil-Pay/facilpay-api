import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
  Unique,
} from 'typeorm';
import { InvoiceLineItem } from './invoice-line-item.entity';

export enum InvoiceStatus {
  DRAFT = 'DRAFT',
  OPEN = 'OPEN',
  PAID = 'PAID',
  VOID = 'VOID',
  OVERDUE = 'OVERDUE',
  UNCOLLECTIBLE = 'UNCOLLECTIBLE',
}

@Entity('invoices')
@Unique('UQ_invoices_merchant_number', ['merchantId', 'number'])
@Index('IDX_invoices_merchant_status', ['merchantId', 'status'])
export class Invoice {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'integer' })
  number: number;

  @Column({ type: 'uuid' })
  merchantId: string;

  @Column({ type: 'varchar', length: 320 })
  customerEmail: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  customerName: string | null;

  @Column({ type: 'varchar', length: 3 })
  currency: string;

  @Column({ type: 'decimal', precision: 12, scale: 2 })
  subtotal: string;

  @Column({ type: 'decimal', precision: 5, scale: 2, default: 0 })
  taxRate: string;

  @Column({ type: 'decimal', precision: 12, scale: 2 })
  taxAmount: string;

  @Column({ type: 'decimal', precision: 12, scale: 2 })
  total: string;

  @Column({ type: 'timestamp with time zone' })
  dueDate: Date;

  @Column({ type: 'varchar', length: 16, default: InvoiceStatus.DRAFT })
  status: InvoiceStatus;

  @Column({ type: 'uuid', nullable: true })
  paymentId: string | null;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 64, unique: true })
  publicToken: string;

  @OneToMany(() => InvoiceLineItem, (lineItem) => lineItem.invoice, {
    cascade: true,
  })
  lineItems: InvoiceLineItem[];

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
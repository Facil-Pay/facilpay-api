import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

@Entity('merchant_branding')
@Index('idx_merchant_branding_merchant_id', ['merchantId'], { unique: true })
export class MerchantBranding {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  merchantId: string;

  @Column({ length: 100, nullable: true })
  displayName: string | null;

  @Column({ nullable: true })
  logo: string | null;

  @Column({ length: 7, default: '#1a1a2e' })
  primaryColor: string = '#1a1a2e';

  @Column({ nullable: true })
  supportEmail: string | null;

  @Column({ nullable: true })
  supportUrl: string | null;

  @Column({ type: 'text', nullable: true })
  receiptFooter: string | null;

  @Column({ type: 'text', nullable: true })
  invoiceFooter: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  taxId: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
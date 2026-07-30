import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

@Entity('merchant_ip_allowlists')
export class MerchantIpAllowlist {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column()
  merchantId: string;

  /**
   * List of allowed IPs or CIDR ranges (e.g. "1.2.3.4", "10.0.0.0/8").
   * An empty array means no restriction.
   */
  @Column({ type: 'text', array: true, default: '{}' })
  allowedIps: string[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

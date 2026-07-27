import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

@Entity('merchant_fee_configs')
export class MerchantFeeConfig {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column()
  merchantId: string;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  flatFee: number;

  @Column({ type: 'decimal', precision: 5, scale: 2, default: 0 })
  percentageFee: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  minFee: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

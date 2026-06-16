import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

export enum SettlementStatus {
  PENDING = 'PENDING',
  SUBMITTED = 'SUBMITTED',
  CONFIRMED = 'CONFIRMED',
  FAILED = 'FAILED',
}

@Entity('stellar_settlements')
export class StellarSettlement {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('idx_stellar_settlements_payment_id', { unique: true })
  @Column({ type: 'uuid' })
  paymentId: string;

  @Column()
  destinationAddress: string;

  @Column({ type: 'varchar' })
  xlmAmount: string;

  @Column({ type: 'enum', enum: SettlementStatus, default: SettlementStatus.PENDING })
  status: SettlementStatus;

  @Column({ nullable: true })
  transactionHash: string | null;

  @Column({ type: 'int', nullable: true })
  ledger: number | null;

  @Column({ type: 'text', nullable: true })
  errorMessage: string | null;

  @Column({ nullable: true })
  memo: string | null;

  @CreateDateColumn()
  createdAt: Date;
}

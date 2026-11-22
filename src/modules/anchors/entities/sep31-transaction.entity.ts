import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type Sep31TransactionStatus =
  | 'pending_sender'
  | 'pending_receiver'
  | 'completed'
  | 'error';

@Entity('sep31_transactions')
@Index('IDX_sep31_transactions_sender', ['senderAccount', 'startedAt'])
@Index('UQ_sep31_transactions_paymentId', ['paymentId'], { unique: true })
@Index('UQ_sep31_transactions_stellarMemo', ['stellarMemo'], { unique: true })
export class Sep31Transaction {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  paymentId: string;

  @Column({ type: 'uuid' })
  merchantId: string;

  @Column({ type: 'uuid' })
  senderId: string;

  @Column({ type: 'uuid' })
  receiverId: string;

  @Column({ type: 'varchar', length: 56 })
  senderAccount: string;

  @Column({ type: 'varchar', length: 12 })
  assetCode: string;

  @Column({ type: 'varchar', length: 56, nullable: true })
  assetIssuer: string | null;

  @Column({ type: 'decimal', precision: 20, scale: 7 })
  amount: string;

  @Column({ type: 'varchar', length: 64 })
  stellarMemo: string;

  @Column({ type: 'varchar', length: 56 })
  stellarAccountId: string;

  @Column({ type: 'varchar', length: 32, default: 'pending_sender' })
  status: Sep31TransactionStatus;

  @CreateDateColumn({ type: 'timestamptz' })
  startedAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}

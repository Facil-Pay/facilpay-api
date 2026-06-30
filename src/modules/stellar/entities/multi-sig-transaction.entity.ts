import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum MultiSigTransactionStatus {
  PENDING_SIGNATURES = 'pending_signatures',
  SUBMITTED = 'submitted',
  FAILED = 'failed',
}

@Entity('multi_sig_transactions')
export class MultiSigTransaction {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('text')
  xdr: string;

  @Column()
  sourceAccount: string;

  @Column({
    type: 'enum',
    enum: MultiSigTransactionStatus,
    default: MultiSigTransactionStatus.PENDING_SIGNATURES,
  })
  status: MultiSigTransactionStatus;

  @Column({ type: 'int' })
  requiredSignatures: number;

  @Column({ type: 'int', default: 0 })
  collectedSignatures: number;

  @Column('text', { array: true, default: [] })
  signers: string[];

  @Column('text', { nullable: true })
  transactionHash: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

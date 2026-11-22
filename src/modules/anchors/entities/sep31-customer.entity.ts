import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type Sep31CustomerType = 'sender' | 'receiver';

@Entity('sep31_customers')
@Index('IDX_sep31_customers_sender_type', ['senderAccount', 'type'])
export class Sep31Customer {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 56 })
  senderAccount: string;

  @Column({ type: 'varchar', length: 16 })
  type: Sep31CustomerType;

  @Column({ type: 'uuid', nullable: true })
  merchantId: string | null;

  @Column({ type: 'varchar', length: 32, default: 'NEEDS_INFO' })
  status: string;

  @Column({ type: 'text', nullable: true })
  encryptedFields: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}

import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('customer_notes')
@Index('idx_customer_notes_customer', ['customerId'])
export class CustomerNote {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  customerId: string;

  @Column({ type: 'text' })
  content: string;

  @Column('uuid')
  authorId: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  authorName: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}

import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';
import { Payment } from './payment.entity';

@Entity('payment_notes')
@Index('IDX_payment_notes_paymentId_createdAt', ['paymentId', 'createdAt'])
export class PaymentNote {
  @PrimaryGeneratedColumn('uuid')
  @ApiProperty()
  id: string;

  @Column('uuid')
  @ApiProperty()
  paymentId: string;

  @ManyToOne(() => Payment, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'paymentId' })
  payment: Payment;

  @Column({ type: 'varchar', length: 255 })
  @ApiProperty()
  authorId: string;

  @Column({ type: 'text' })
  @ApiProperty()
  body: string;

  @CreateDateColumn({ type: 'timestamptz' })
  @ApiProperty()
  createdAt: Date;
}
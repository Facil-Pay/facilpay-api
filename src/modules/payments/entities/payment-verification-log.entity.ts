import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { VerificationMismatch } from '../payment-verification.service';

@Entity('payment_verification_logs')
export class PaymentVerificationLog {
  @PrimaryGeneratedColumn('uuid')
  @ApiProperty()
  id: string;

  @ApiProperty()
  @Index('IDX_pvl_paymentId')
  @Column({ type: 'uuid' })
  paymentId: string;

  @ApiProperty()
  @Index('IDX_pvl_transactionHash')
  @Column({ type: 'varchar', length: 128 })
  transactionHash: string;

  @ApiProperty()
  @Column({ type: 'boolean' })
  matched: boolean;

  @ApiProperty({ type: 'array', items: { type: 'object' } })
  @Column({ type: 'jsonb', default: [] })
  mismatches: VerificationMismatch[];

  @ApiProperty()
  @Column({ type: 'boolean', default: false })
  paymentCompleted: boolean;

  @ApiPropertyOptional()
  @Column({ type: 'varchar', nullable: true })
  requestedBy: string | null;

  @ApiProperty()
  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}

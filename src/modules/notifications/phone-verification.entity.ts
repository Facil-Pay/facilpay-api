import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';

@Entity('phone_verifications')
@Index('IDX_phone_verifications_userId', ['userId'])
export class PhoneVerification {
  @PrimaryGeneratedColumn('uuid')
  @ApiProperty()
  id: string;

  @Column('uuid')
  @ApiProperty()
  userId: string;

  @Column({ type: 'varchar', length: 20 })
  @ApiProperty({ example: '+1234567890' })
  phoneNumber: string;

  @Column({ default: false })
  @ApiProperty()
  verified: boolean;

  @Column({ type: 'varchar', length: 6, nullable: true })
  verificationCode: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  codeExpiresAt: Date | null;

  @Column({ type: 'integer', default: 0 })
  verificationAttempts: number;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}

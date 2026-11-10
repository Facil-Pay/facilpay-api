import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Unique,
  Index,
} from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';

@Entity('verified_phone_numbers')
@Unique('UQ_verified_phone_numbers_userId', ['userId'])
@Index('IDX_verified_phone_numbers_userId', ['userId'])
export class VerifiedPhoneNumber {
  @PrimaryGeneratedColumn('uuid')
  @ApiProperty()
  id: string;

  @Column('uuid')
  @ApiProperty()
  userId: string;

  @Column({ type: 'varchar', length: 24 })
  @ApiProperty({ example: '+14155552671' })
  phoneNumber: string;

  @Column({ default: false })
  @ApiProperty({ example: true })
  verified: boolean;

  @Column({ type: 'timestamptz', nullable: true })
  @ApiProperty({ required: false, nullable: true })
  verifiedAt: Date | null;

  @Column({ type: 'varchar', length: 128, nullable: true })
  otpCodeHash: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  otpExpiresAt: Date | null;

  @Column({ type: 'int', default: 0 })
  attempts: number;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}

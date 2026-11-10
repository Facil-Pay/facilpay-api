import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TeamRole } from './merchant-member.entity';

@Entity('merchant_invitations')
@Index('IDX_merchant_invitations_tokenHash', ['tokenHash'])
@Index('IDX_merchant_invitations_merchantId', ['merchantId'])
@Index('IDX_merchant_invitations_email', ['email'])
export class MerchantInvitation {
  @PrimaryGeneratedColumn('uuid')
  @ApiProperty()
  id: string;

  @Column('uuid')
  @ApiProperty()
  merchantId: string;

  @Column({ type: 'varchar', length: 255 })
  @ApiProperty({ example: 'teammate@example.com' })
  email: string;

  @Column({ type: 'varchar', length: 20 })
  @ApiProperty({ enum: TeamRole })
  role: TeamRole;

  @Column({ type: 'varchar', length: 128 })
  tokenHash: string;

  @Column('uuid')
  @ApiProperty()
  invitedBy: string;

  @Column({ type: 'timestamptz' })
  @ApiProperty()
  expiresAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  @ApiPropertyOptional({ example: null })
  acceptedAt: Date | null = null;

  @Column({ type: 'timestamptz', nullable: true })
  @ApiPropertyOptional({ example: null })
  revokedAt: Date | null = null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}

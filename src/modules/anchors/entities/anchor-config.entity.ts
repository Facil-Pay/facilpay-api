import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

@Entity('anchor_configs')
@Index('IDX_anchor_configs_merchant_domain', ['merchantId', 'homeDomain'], { unique: true })
export class AnchorConfig {
  @PrimaryGeneratedColumn('uuid')
  @ApiProperty()
  id: string;

  @ApiProperty({ description: 'Merchant this anchor config belongs to' })
  @Index('IDX_anchor_configs_merchantId')
  @Column({ type: 'varchar' })
  merchantId: string;

  @ApiProperty({ description: 'Anchor home domain, e.g. testanchor.stellar.org' })
  @Column({ type: 'varchar', length: 253 })
  homeDomain: string;

  @ApiProperty({ description: 'Asset codes supported by this anchor', example: ['USDC', 'SRT'] })
  @Column({ type: 'text', array: true, default: () => "'{}'" })
  supportedAssets: string[];

  @ApiProperty({ description: 'Whether this anchor config is active' })
  @Column({ type: 'boolean', default: true })
  isActive: boolean;

  @ApiProperty()
  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @ApiProperty()
  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}

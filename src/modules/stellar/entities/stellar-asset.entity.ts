import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

@Entity('stellar_assets')
export class StellarAsset {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  merchantId: string;

  @Column()
  assetCode: string;

  @Column()
  assetIssuer: string;

  @Column({ default: true })
  isAccepted: boolean;

  @Column({ type: 'timestamp with time zone', nullable: true })
  trustlineAddedAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

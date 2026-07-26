import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

@Entity('merchant_geo_restrictions')
export class MerchantGeoRestriction {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column()
  merchantId: string;

  @Column({ type: 'text', array: true, nullable: true })
  allowedCountries: string[] | null = null;

  @Column({ type: 'text', array: true, nullable: true })
  blockedCountries: string[] | null = null;

  @Column({ default: true })
  bypassInTestMode: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

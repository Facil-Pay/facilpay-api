import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

export enum OnboardingStatus {
  PENDING = 'pending',
  UNDER_REVIEW = 'under_review',
  APPROVED = 'approved',
  REJECTED = 'rejected',
}

@Entity('merchant_onboardings')
export class MerchantOnboarding {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column()
  merchantId: string;

  @Column({ nullable: true })
  businessName: string | null;

  @Column({ nullable: true })
  businessEmail: string | null;

  @Column({ nullable: true })
  businessAddress: string | null;

  @Column({ nullable: true })
  idDocumentUrl: string | null;

  @Column({ nullable: true })
  businessCertificateUrl: string | null;

  @Column({ default: OnboardingStatus.PENDING })
  status: OnboardingStatus;

  @Column({ nullable: true })
  rejectionReason: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

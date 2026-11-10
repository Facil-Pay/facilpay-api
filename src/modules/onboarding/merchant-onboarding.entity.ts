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
  CLOSED = 'closed',
}

@Entity('merchant_onboardings')
export class MerchantOnboarding {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column()
  merchantId: string;

  /** Display name for the business (e.g., "Acme Corp") */
  @Column({ nullable: true })
  businessName: string | null;

  /** Legal registered business name */
  @Column({ nullable: true })
  legalName: string | null;

  @Column({ nullable: true })
  businessEmail: string | null;

  @Column({ nullable: true })
  businessAddress: string | null;

  /** Business website URL */
  @Column({ nullable: true })
  website: string | null;

  /** Support email for customer inquiries */
  @Column({ nullable: true })
  supportEmail: string | null;

  /** Support phone number */
  @Column({ nullable: true })
  supportPhone: string | null;

  /** Country code (ISO 3166-1 alpha-2) */
  @Column({ length: 2, nullable: true })
  country: string | null;

  /** Timezone (e.g., "America/New_York") */
  @Column({ nullable: true })
  timezone: string | null;

  /** Default currency for payments (ISO 4217) */
  @Column({ length: 3, nullable: true })
  defaultCurrency: string | null;

  @Column({ nullable: true })
  idDocumentUrl: string | null;

  @Column({ nullable: true })
  businessCertificateUrl: string | null;

  @Column({ default: OnboardingStatus.PENDING })
  status: OnboardingStatus;

  @Column({ nullable: true })
  rejectionReason: string | null;

  /** Flag for fields that require re-review when changed */
  @Column({ default: false })
  requiresReReview: boolean = false;

  @Column({ type: 'timestamptz', nullable: true })
  closedAt: Date | null = null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

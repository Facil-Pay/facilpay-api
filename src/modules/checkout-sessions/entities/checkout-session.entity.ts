import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

export enum CheckoutSessionStatus {
  OPEN = 'OPEN',
  COMPLETE = 'COMPLETE',
  EXPIRED = 'EXPIRED',
}

export type LineItem = {
  productId?: string | null;
  name: string;
  description?: string;
  quantity: number;
  unitAmount: number; // In smallest currency unit (e.g., cents)
};

/** Configuration describing whether a session collects a shipping address. */
export type ShippingAddressCollection = {
  allowedCountries: string[]; // ISO 3166-1 alpha-2 codes; empty means unrestricted
};

/** A fixed shipping rate, in the smallest currency unit (e.g., cents). */
export type ShippingOption = {
  id: string;
  label: string;
  amount: number;
};

/** Address collected from the payer during checkout. */
export type ShippingAddress = {
  name?: string;
  line1: string;
  line2?: string;
  city: string;
  state?: string;
  postalCode: string;
  country: string; // ISO 3166-1 alpha-2 code
};

@Entity('checkout_sessions')
@Index('idx_checkout_sessions_merchant_id', ['merchantId'])
@Index('idx_checkout_sessions_public_id', ['publicId'], { unique: true })
export class CheckoutSession {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column({ length: 32 })
  publicId: string; // Public-facing ID for URLs

  @Column()
  merchantId: string;

  @Column('jsonb', { default: [] })
  lineItems: LineItem[];

  @Column({ length: 3 })
  currency: string;

  /** Amount due in smallest currency unit, after any coupon discount. */
  @Column({ type: 'decimal', precision: 10, scale: 2 })
  total: number;

  /** Line-item total before discount, in smallest currency unit. */
  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  subtotal: number | null;

  /** Coupon discount in smallest currency unit. */
  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  discountAmount: number;

  /** Shipping address collection settings configured by the merchant. */
  @Column({ type: 'jsonb', nullable: true })
  shippingAddressCollection: ShippingAddressCollection | null;

  /** Fixed shipping rates offered for this session. */
  @Column({ type: 'jsonb', default: () => "'[]'" })
  shippingOptions: ShippingOption[];

  /** Address submitted by the payer, if the session collects one. */
  @Column({ type: 'jsonb', nullable: true })
  shippingAddress: ShippingAddress | null;

  /** Identifier of the selected shipping option, if any. */
  @Column({ type: 'varchar', length: 64, nullable: true })
  shippingOptionId: string | null;

  /** Selected shipping rate in smallest currency unit. */
  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  shippingAmount: number;

  @Column({ type: 'uuid', nullable: true })
  couponId: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  couponCode: string | null;

  @Column({ nullable: true })
  customerId: string | null;

  @Column({ nullable: true })
  customerEmail: string | null;

  @Column()
  successUrl: string;

  @Column()
  cancelUrl: string;

  @Column({ type: 'timestamp' })
  expiresAt: Date;

  @Column({
    type: 'enum',
    enum: CheckoutSessionStatus,
    default: CheckoutSessionStatus.OPEN,
  })
  status: CheckoutSessionStatus;

  @Column({ nullable: true })
  paymentId: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

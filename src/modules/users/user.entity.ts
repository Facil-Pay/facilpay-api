import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import { UserRole } from '../../common/constants/roles';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  email: string;

  @Column()
  password: string;

  @Column({ type: 'varchar', nullable: true })
  name: string | null = null;

  /** Preferred language for transactional emails (en, fr, es, pt). */
  @Column({ type: 'varchar', length: 10, default: 'en' })
  locale: string = 'en';

  @Column('text', { array: true, default: [UserRole.USER] })
  roles: UserRole[] = [UserRole.USER];

  @Column({ nullable: true })
  roleId: string | null = null;

  @Column({ default: false })
  isEmailVerified: boolean = false;

  @Column({ default: true })
  isActive: boolean = true;

  @Column({ type: 'varchar', length: 16, default: 'ACTIVE' })
  status: 'ACTIVE' | 'SUSPENDED' = 'ACTIVE';

  @Column({ type: 'text', nullable: true })
  suspendedReason: string | null = null;

  @Column({ type: 'timestamptz', nullable: true })
  suspendedAt: Date | null = null;

  @Column({ nullable: true })
  twoFactorSecret: string | null = null;

  @Column({ default: false })
  twoFactorEnabled: boolean = false;

  @Column({ default: true })
  loginAlertsEnabled: boolean = true;

  @Column({ default: false })
  passwordResetRequired: boolean = false;

  @Column('text', { array: true, nullable: true })
  backupCodes: string[] | null = null;

  @Column({ type: 'timestamp', nullable: true })
  deletedAt: Date | null = null;

  @Column({ default: 0 })
  failedLoginAttempts: number = 0;

  @Column({ nullable: true })
  lockedUntil: Date | null = null;

  @Column({ default: false })
  rateLimitEnabled: boolean = false;

  @Column({ nullable: true })
  rateLimitLimit: number | null = null;

  @Column({ nullable: true })
  rateLimitTtl: number | null = null;

  /** Pending new email address awaiting confirmation (#428) */
  @Column({ type: 'varchar', nullable: true })
  pendingEmail: string | null = null;

  /** JWT token sent to the new address for email-change confirmation (#428) */
  @Column({ type: 'varchar', nullable: true })
  emailChangeToken: string | null = null;

  /** Expiry of the email-change confirmation token (#428) */
  @Column({ type: 'timestamptz', nullable: true })
  emailChangeTokenExpiresAt: Date | null = null;

  /** Timestamp of the most recent GDPR data-export request, used for rate-limiting (#427) */
  @Column({ type: 'timestamptz', nullable: true })
  dataExportRequestedAt: Date | null = null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  constructor(partial?: Partial<User>) {
    Object.assign(this, partial);
    if (!this.roles) {
      this.roles = [UserRole.USER];
    }
    if (this.isEmailVerified === undefined) {
      this.isEmailVerified = false;
    }
    if (this.isActive === undefined) {
      this.isActive = true;
    }
    if (this.twoFactorSecret === undefined) {
      this.twoFactorSecret = null;
    }
    if (this.twoFactorEnabled === undefined) {
      this.twoFactorEnabled = false;
    }
    if (this.backupCodes === undefined) {
      this.backupCodes = null;
    }
    if (this.deletedAt === undefined) {
      this.deletedAt = null;
    }
    if (this.failedLoginAttempts === undefined) {
      this.failedLoginAttempts = 0;
    }
    if (this.lockedUntil === undefined) {
      this.lockedUntil = null;
    }
  }
}

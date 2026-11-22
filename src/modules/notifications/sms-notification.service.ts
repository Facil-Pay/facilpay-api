import {
  Injectable,
  BadRequestException,
  NotFoundException,
  Logger,
  Inject,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PhoneVerification } from './phone-verification.entity';
import { NotificationPreferencesService } from './notification-preferences.service';
import { SmsProvider } from './interfaces/sms-provider.interface';
import { NotificationCategory } from './notification-preference.entity';

@Injectable()
export class SmsNotificationService {
  private readonly logger = new Logger(SmsNotificationService.name);

  constructor(
    @InjectRepository(PhoneVerification)
    private readonly phoneVerificationRepo: Repository<PhoneVerification>,
    @Inject('SMS_PROVIDER')
    private readonly smsProvider: SmsProvider,
    private readonly notificationPreferencesService: NotificationPreferencesService,
  ) {}

  /**
   * Send verification code to phone number
   */
  async sendVerificationCode(userId: string, phoneNumber: string): Promise<void> {
    // Generate 6-digit code
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    // Upsert phone verification record
    let verification = await this.phoneVerificationRepo.findOne({
      where: { userId, phoneNumber },
    });

    if (verification) {
      verification.verificationCode = code;
      verification.codeExpiresAt = expiresAt;
      verification.verified = false;
      verification.verificationAttempts = 0;
    } else {
      verification = this.phoneVerificationRepo.create({
        userId,
        phoneNumber,
        verificationCode: code,
        codeExpiresAt: expiresAt,
        verified: false,
        verificationAttempts: 0,
      });
    }

    await this.phoneVerificationRepo.save(verification);

    // Send SMS
    await this.smsProvider.sendVerificationCode(phoneNumber, code);
    this.logger.log(`Verification code sent to ${phoneNumber} for user ${userId}`);
  }

  /**
   * Verify phone number with code
   */
  async verifyPhoneNumber(
    userId: string,
    phoneNumber: string,
    code: string,
  ): Promise<boolean> {
    const verification = await this.phoneVerificationRepo.findOne({
      where: { userId, phoneNumber },
    });

    if (!verification) {
      throw new NotFoundException('No verification request found for this phone number');
    }

    if (verification.verified) {
      return true; // Already verified
    }

    if (!verification.codeExpiresAt || verification.codeExpiresAt < new Date()) {
      throw new BadRequestException('Verification code has expired');
    }

    if (verification.verificationAttempts >= 3) {
      throw new BadRequestException('Too many verification attempts. Request a new code.');
    }

    if (verification.verificationCode !== code) {
      verification.verificationAttempts += 1;
      await this.phoneVerificationRepo.save(verification);
      throw new BadRequestException('Invalid verification code');
    }

    // Mark as verified
    verification.verified = true;
    verification.verificationCode = null;
    verification.codeExpiresAt = null;
    await this.phoneVerificationRepo.save(verification);

    this.logger.log(`Phone number ${phoneNumber} verified for user ${userId}`);
    return true;
  }

  /**
   * Get verified phone number for user
   */
  async getVerifiedPhoneNumber(userId: string): Promise<string | null> {
    const verification = await this.phoneVerificationRepo.findOne({
      where: { userId, verified: true },
      order: { updatedAt: 'DESC' },
    });

    return verification?.phoneNumber || null;
  }

  /**
   * Send payment received notification
   */
  async sendPaymentReceived(
    userId: string,
    amount: string,
    currency: string,
  ): Promise<void> {
    const phoneNumber = await this.getVerifiedPhoneNumber(userId);
    if (!phoneNumber) {
      this.logger.debug(`No verified phone number for user ${userId}`);
      return;
    }

    const preferences = await this.notificationPreferencesService.getPreferences(userId);
    const paymentPref = preferences.find((p) => p.category === NotificationCategory.PAYMENTS);

    // Check if SMS is enabled for payments (we'll use email field as proxy for SMS until schema is updated)
    if (!paymentPref || !paymentPref.email) {
      this.logger.debug(`SMS notifications disabled for payments for user ${userId}`);
      return;
    }

    const message = `Payment received: ${amount} ${currency}. Thank you!`;
    await this.smsProvider.sendSms(phoneNumber, message);
    this.logger.log(`Payment notification sent to ${phoneNumber}`);
  }

  /**
   * Send payout completed notification
   */
  async sendPayoutCompleted(
    userId: string,
    amount: string,
    currency: string,
  ): Promise<void> {
    const phoneNumber = await this.getVerifiedPhoneNumber(userId);
    if (!phoneNumber) {
      this.logger.debug(`No verified phone number for user ${userId}`);
      return;
    }

    const preferences = await this.notificationPreferencesService.getPreferences(userId);
    const settlementPref = preferences.find(
      (p) => p.category === NotificationCategory.SETTLEMENTS,
    );

    if (!settlementPref || !settlementPref.email) {
      this.logger.debug(`SMS notifications disabled for settlements for user ${userId}`);
      return;
    }

    const message = `Payout completed: ${amount} ${currency} has been sent to your account.`;
    await this.smsProvider.sendSms(phoneNumber, message);
    this.logger.log(`Payout notification sent to ${phoneNumber}`);
  }

  /**
   * Remove phone number
   */
  async removePhoneNumber(userId: string, phoneNumber: string): Promise<void> {
    await this.phoneVerificationRepo.delete({ userId, phoneNumber });
    this.logger.log(`Phone number ${phoneNumber} removed for user ${userId}`);
  }
}

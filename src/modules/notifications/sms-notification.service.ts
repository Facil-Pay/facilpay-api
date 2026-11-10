import {
  Injectable,
  Inject,
  BadRequestException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import * as crypto from 'crypto';
import { Logger } from 'pino';
import { AppLogger } from '../logger/logger.service';
import { VerifiedPhoneNumber } from './verified-phone-number.entity';
import { NotificationPreferencesService } from './notification-preferences.service';
import { NotificationCategory } from './notification-preference.entity';

export const SMS_PROVIDER = 'SMS_PROVIDER';

export interface SmsMessage {
  to: string;
  body: string;
  metadata?: Record<string, unknown>;
}

export interface SmsSendResult {
  messageId: string;
  provider: string;
  status: 'sent' | 'queued' | 'failed';
}

export interface SmsProvider {
  readonly name: string;
  sendSms(message: SmsMessage): Promise<SmsSendResult>;
}

@Injectable()
export class TwilioSmsProvider implements SmsProvider {
  readonly name = 'twilio';
  private readonly accountSid: string;
  private readonly authToken: string;
  private readonly fromNumber: string;

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {
    this.accountSid = this.configService.get<string>('TWILIO_ACCOUNT_SID', '');
    this.authToken = this.configService.get<string>('TWILIO_AUTH_TOKEN', '');
    this.fromNumber = this.configService.get<string>('TWILIO_FROM_NUMBER', '');
  }

  async sendSms(message: SmsMessage): Promise<SmsSendResult> {
    if (!this.accountSid || !this.authToken || !this.fromNumber) {
      throw new Error('Twilio SMS provider is not configured');
    }

    const url = `https://api.twilio.com/2010-04-01/Accounts/${this.accountSid}/Messages.json`;
    const body = new URLSearchParams({
      To: message.to,
      From: this.fromNumber,
      Body: message.body,
    }).toString();

    const basicAuth = Buffer.from(
      `${this.accountSid}:${this.authToken}`,
    ).toString('base64');

    const response = await firstValueFrom(
      this.httpService.post(url, body, {
        headers: {
          Authorization: `Basic ${basicAuth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      }),
    );

    return {
      messageId: response.data?.sid ?? `twilio-${Date.now()}`,
      provider: this.name,
      status:
        response.data?.status === 'failed' ||
        response.data?.status === 'undelivered'
          ? 'failed'
          : 'queued',
    };
  }
}

export interface PaymentReceivedSmsPayload {
  userId: string;
  paymentId: string;
  amount: string | number;
  currency: string;
}

export interface PayoutCompletedSmsPayload {
  userId: string;
  payoutId: string;
  amount: string | number;
  asset: string;
  destination?: string;
}

const E164_PHONE_REGEX = /^\+[1-9]\d{6,14}$/;
const OTP_TTL_MS = 10 * 60 * 1000;
const MAX_OTP_ATTEMPTS = 5;

@Injectable()
export class SmsNotificationService {
  private readonly logger: Logger;

  constructor(
    @Inject(SMS_PROVIDER)
    private readonly smsProvider: SmsProvider,
    @InjectRepository(VerifiedPhoneNumber)
    private readonly phoneRepo: Repository<VerifiedPhoneNumber>,
    private readonly preferencesService: NotificationPreferencesService,
    appLogger: AppLogger,
  ) {
    this.logger = appLogger.child({ module: SmsNotificationService.name });
  }

  /**
   * Initiates phone verification by generating a 6-digit OTP and sending it via the configured SMS provider.
   */
  async requestPhoneVerification(
    userId: string,
    phoneNumber: string,
  ): Promise<{ expiresAt: Date }> {
    const normalized = phoneNumber.trim();
    if (!E164_PHONE_REGEX.test(normalized)) {
      throw new BadRequestException(
        'Phone number must be in E.164 format (e.g. +14155552671)',
      );
    }

    const otpCode = crypto.randomInt(100000, 1000000).toString();
    const otpCodeHash = this.hashOtp(otpCode);
    const otpExpiresAt = new Date(Date.now() + OTP_TTL_MS);

    const existing = await this.phoneRepo.findOne({ where: { userId } });
    const record = existing
      ? Object.assign(existing, {
          phoneNumber: normalized,
          verified: false,
          verifiedAt: null,
          otpCodeHash,
          otpExpiresAt,
          attempts: 0,
        })
      : this.phoneRepo.create({
          userId,
          phoneNumber: normalized,
          verified: false,
          verifiedAt: null,
          otpCodeHash,
          otpExpiresAt,
          attempts: 0,
        });

    await this.phoneRepo.save(record);

    await this.smsProvider.sendSms({
      to: normalized,
      body: `Your FacilPay verification code is ${otpCode}. It expires in 10 minutes.`,
      metadata: { event: 'phone_verification_otp', userId },
    });

    this.logger.info(
      { userId, provider: this.smsProvider.name },
      'Sent phone verification OTP',
    );

    return { expiresAt: otpExpiresAt };
  }

  /**
   * Verifies a phone number using the 6-digit OTP code.
   */
  async verifyPhoneOtp(
    userId: string,
    code: string,
    now: Date = new Date(),
  ): Promise<VerifiedPhoneNumber> {
    const record = await this.phoneRepo.findOne({ where: { userId } });
    if (!record || !record.otpCodeHash || !record.otpExpiresAt) {
      throw new BadRequestException('No pending phone verification found');
    }

    if (record.attempts >= MAX_OTP_ATTEMPTS) {
      throw new BadRequestException(
        'Maximum OTP verification attempts exceeded. Please request a new code.',
      );
    }

    if (now.getTime() > new Date(record.otpExpiresAt).getTime()) {
      throw new BadRequestException('Verification code has expired');
    }

    const candidateHash = this.hashOtp(code.trim());
    const hashesMatch =
      candidateHash.length === record.otpCodeHash.length &&
      crypto.timingSafeEqual(
        Buffer.from(candidateHash, 'utf8'),
        Buffer.from(record.otpCodeHash, 'utf8'),
      );

    if (!hashesMatch) {
      record.attempts += 1;
      await this.phoneRepo.save(record);
      throw new BadRequestException('Invalid verification code');
    }

    record.verified = true;
    record.verifiedAt = now;
    record.otpCodeHash = null;
    record.otpExpiresAt = null;
    record.attempts = 0;

    return this.phoneRepo.save(record);
  }

  async getVerifiedPhone(userId: string): Promise<VerifiedPhoneNumber | null> {
    const record = await this.phoneRepo.findOne({
      where: { userId, verified: true },
    });
    return record ?? null;
  }

  /**
   * Sends a payment-received SMS if the user has a verified phone number and SMS enabled for PAYMENTS.
   */
  async sendPaymentReceivedSms(
    payload: PaymentReceivedSmsPayload,
  ): Promise<SmsSendResult | null> {
    const enabled = await this.preferencesService.isSmsEnabled(
      payload.userId,
      NotificationCategory.PAYMENTS,
    );
    if (!enabled) {
      this.logger.debug(
        { userId: payload.userId, paymentId: payload.paymentId },
        'SMS notifications disabled for payments category',
      );
      return null;
    }

    const verifiedPhone = await this.getVerifiedPhone(payload.userId);
    if (!verifiedPhone) {
      this.logger.debug(
        { userId: payload.userId, paymentId: payload.paymentId },
        'No verified phone number for user; skipping payment SMS',
      );
      return null;
    }

    const formattedAmount =
      typeof payload.amount === 'number'
        ? payload.amount.toFixed(2)
        : payload.amount;

    const result = await this.smsProvider.sendSms({
      to: verifiedPhone.phoneNumber,
      body: `FacilPay: Payment ${payload.paymentId} of ${formattedAmount} ${payload.currency} has been received.`,
      metadata: {
        event: 'payment_received',
        userId: payload.userId,
        paymentId: payload.paymentId,
      },
    });

    this.logger.info(
      {
        userId: payload.userId,
        paymentId: payload.paymentId,
        messageId: result.messageId,
        provider: result.provider,
      },
      'Payment received SMS sent',
    );
    return result;
  }

  /**
   * Sends a payout-completed SMS if the user has a verified phone number and SMS enabled for SETTLEMENTS.
   */
  async sendPayoutCompletedSms(
    payload: PayoutCompletedSmsPayload,
  ): Promise<SmsSendResult | null> {
    const enabled = await this.preferencesService.isSmsEnabled(
      payload.userId,
      NotificationCategory.SETTLEMENTS,
    );
    if (!enabled) {
      this.logger.debug(
        { userId: payload.userId, payoutId: payload.payoutId },
        'SMS notifications disabled for settlements category',
      );
      return null;
    }

    const verifiedPhone = await this.getVerifiedPhone(payload.userId);
    if (!verifiedPhone) {
      this.logger.debug(
        { userId: payload.userId, payoutId: payload.payoutId },
        'No verified phone number for user; skipping payout SMS',
      );
      return null;
    }

    const formattedAmount =
      typeof payload.amount === 'number'
        ? payload.amount.toFixed(2)
        : payload.amount;

    const result = await this.smsProvider.sendSms({
      to: verifiedPhone.phoneNumber,
      body: `FacilPay: Payout ${payload.payoutId} of ${formattedAmount} ${payload.asset} has completed.`,
      metadata: {
        event: 'payout_completed',
        userId: payload.userId,
        payoutId: payload.payoutId,
      },
    });

    this.logger.info(
      {
        userId: payload.userId,
        payoutId: payload.payoutId,
        messageId: result.messageId,
        provider: result.provider,
      },
      'Payout completed SMS sent',
    );
    return result;
  }

  private hashOtp(code: string): string {
    return crypto.createHash('sha256').update(code).digest('hex');
  }
}

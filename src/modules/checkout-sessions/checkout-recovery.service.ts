import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { randomBytes } from 'crypto';
import { IsNull, Not, Repository } from 'typeorm';
import type { Logger } from 'pino';
import {
  CheckoutSession,
  CheckoutSessionStatus,
  LineItem,
} from './entities/checkout-session.entity';
import { MerchantsService } from '../merchants/merchants.service';
import { NotificationPreferencesService } from '../notifications/notification-preferences.service';
import { NotificationCategory } from '../notifications/notification-preference.entity';
import { EmailSuppression } from '../notifications/email-suppression.entity';
import { EmailNotificationService } from '../notifications/email-notification.service';
import { AppLogger } from '../logger/logger.service';

const DEFAULT_RECOVERY_DELAY_MINUTES = 60;
const RECOVERY_SESSION_LIFETIME_MINUTES = 30;
const RECOVERY_BATCH_SIZE = 100;

@Injectable()
export class CheckoutRecoveryService {
  private readonly logger: Logger;
  private readonly baseUrl: string;

  constructor(
    @InjectRepository(CheckoutSession)
    private readonly sessionRepo: Repository<CheckoutSession>,
    private readonly merchantsService: MerchantsService,
    private readonly prefsService: NotificationPreferencesService,
    @InjectRepository(EmailSuppression)
    private readonly suppressionRepo: Repository<EmailSuppression>,
    private readonly emailNotificationService: EmailNotificationService,
    private readonly configService: ConfigService,
    appLogger: AppLogger,
  ) {
    this.logger = appLogger.child({ module: CheckoutRecoveryService.name });
    this.baseUrl = this.configService.get(
      'CHECKOUT_BASE_URL',
      'https://checkout.facilpay.com',
    );
  }

  @Cron(CronExpression.EVERY_10_MINUTES)
  async handleRecoveryCron(): Promise<void> {
    await this.sendRecoveryEmails();
  }

  async sendRecoveryEmails(now: Date = new Date()): Promise<number> {
    const candidates = await this.sessionRepo.find({
      where: {
        status: CheckoutSessionStatus.EXPIRED,
        customerEmail: Not(IsNull()),
        recoveryEmailSentAt: IsNull(),
      },
      order: { expiresAt: 'ASC' },
      take: RECOVERY_BATCH_SIZE,
    });

    let sent = 0;
    for (const session of candidates) {
      const settings = await this.merchantsService.getSettings(
        session.merchantId,
      );
      if (!settings?.recoveryEmailsEnabled) {
        continue;
      }

      const delayMinutes =
        settings.recoveryEmailDelayMinutes ?? DEFAULT_RECOVERY_DELAY_MINUTES;
      const eligibleAt = new Date(
        new Date(session.expiresAt).getTime() + delayMinutes * 60_000,
      );
      if (eligibleAt.getTime() > now.getTime()) {
        continue;
      }

      const emailEnabled = await this.prefsService.isEmailEnabled(
        session.merchantId,
        NotificationCategory.CHECKOUT_RECOVERY,
      );
      if (!emailEnabled) {
        continue;
      }

      const email = session.customerEmail!.trim().toLowerCase();
      const suppressed = await this.suppressionRepo.count({
        where: { email },
      });
      if (suppressed > 0) {
        continue;
      }

      const claimed = await this.sessionRepo.update(
        { id: session.id, recoveryEmailSentAt: IsNull() },
        { recoveryEmailSentAt: now },
      );
      if (!claimed.affected) {
        continue;
      }

      try {
        const profile = await this.merchantsService.getProfile(
          session.merchantId,
        );
        await this.emailNotificationService.sendCheckoutRecoveryEmail({
          to: email,
          recoveryUrl: `${this.baseUrl}/recover/${session.publicId}`,
          merchantName: profile.businessName || 'FacilPay',
          formattedTotal: (Number(session.total) / 100).toFixed(2),
          currency: session.currency,
          items: session.lineItems.map((item: LineItem) => ({
            name: item.name,
            quantity: item.quantity,
          })),
        });
        sent += 1;
      } catch (error) {
        this.logger.error(
          { sessionId: session.id, error },
          'Failed to enqueue checkout recovery email',
        );
      }
    }

    if (sent > 0) {
      this.logger.info({ count: sent }, 'Queued checkout recovery emails');
    }
    return sent;
  }

  async createRecoverySession(publicId: string): Promise<CheckoutSession> {
    const original = await this.sessionRepo.findOne({ where: { publicId } });
    if (!original) {
      throw new NotFoundException('Checkout session not found');
    }

    const isExpired =
      original.status === CheckoutSessionStatus.EXPIRED ||
      (original.status === CheckoutSessionStatus.OPEN &&
        new Date(original.expiresAt).getTime() <= Date.now());
    if (!isExpired) {
      throw new BadRequestException(
        'Only expired checkout sessions can be recovered',
      );
    }
    if (!original.customerEmail) {
      throw new BadRequestException('Checkout session has no customer email');
    }

    const subtotal = Number(original.subtotal ?? original.total);
    const expiresAt = new Date(
      Date.now() + RECOVERY_SESSION_LIFETIME_MINUTES * 60_000,
    );

    const session = this.sessionRepo.create({
      publicId: randomBytes(16).toString('base64url'),
      merchantId: original.merchantId,
      lineItems: original.lineItems.map((item) => ({ ...item })),
      currency: original.currency,
      subtotal,
      total: subtotal,
      discountAmount: 0,
      couponId: null,
      couponCode: null,
      customerId: original.customerId,
      customerEmail: original.customerEmail,
      successUrl: original.successUrl,
      cancelUrl: original.cancelUrl,
      expiresAt,
      status: CheckoutSessionStatus.OPEN,
      paymentId: null,
      recoveryEmailSentAt: null,
      recoveredFromId: original.id,
    });

    const saved = await this.sessionRepo.save(session);
    this.logger.info(
      { sessionId: saved.id, recoveredFromId: original.id },
      'Recovery checkout session created',
    );
    return saved;
  }
}

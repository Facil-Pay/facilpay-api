import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Queue } from 'bullmq';
import { DataSource } from 'typeorm';
import { AppLogger } from '../logger/logger.service';
import { Logger } from 'pino';
import { EmailEventType } from './email-log.entity';
import { SendEmailJobData } from './email.processor';
import type { ReportSummary } from '../reports/reports.service';
import { formatDate, formatMoney } from './i18n/locale';
import { translate } from './i18n/messages';
import { NotificationPreferencesService } from './notification-preferences.service';
import { NotificationCategory } from './notification-preference.entity';
import { InAppNotificationsService } from './in-app-notifications.service';
import { InAppNotification, InAppNotificationType } from './in-app-notification.entity';

export interface DailyDigestFailureHighlight {
  id: string;
  type: string;
  title: string;
  body: string;
  createdAt: string;
}

export interface DailyDigestSummary {
  userId: string;
  localDate: string;
  timezone: string;
  totalCount: number;
  countsByType: Record<string, number>;
  failureCount: number;
  failures: DailyDigestFailureHighlight[];
}

export function getLocalDateAndHour(
  date: Date,
  timezone = 'UTC',
): { localDate: string; hour: number } {
  const tz = timezone || 'UTC';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const rawHour = Number(get('hour'));
  return {
    localDate: `${get('year')}-${get('month')}-${get('day')}`,
    hour: rawHour === 24 ? 0 : rawHour,
  };
}

export function summarizeDigestNotifications(
  userId: string,
  localDate: string,
  timezone: string,
  items: Pick<InAppNotification, 'id' | 'type' | 'title' | 'body' | 'createdAt'>[],
): DailyDigestSummary {
  const countsByType: Record<string, number> = {};
  const failures: DailyDigestFailureHighlight[] = [];
  const failurePattern = /fail|reject|dispute|overdue|error|alert|warning/i;

  for (const item of items) {
    countsByType[item.type] = (countsByType[item.type] ?? 0) + 1;
    if (
      failurePattern.test(item.type) ||
      failurePattern.test(item.title) ||
      failurePattern.test(item.body)
    ) {
      failures.push({
        id: item.id,
        type: item.type,
        title: item.title,
        body: item.body,
        createdAt: new Date(item.createdAt).toISOString(),
      });
    }
  }

  return {
    userId,
    localDate,
    timezone,
    totalCount: items.length,
    countsByType,
    failureCount: failures.length,
    failures,
  };
}

@Injectable()
export class EmailNotificationService {
  private readonly logger: Logger;
  private readonly sentDigestKeys = new Set<string>();

  constructor(
    @InjectQueue('emails') private readonly emailQueue: Queue,
    private readonly prefsService: NotificationPreferencesService,
    private readonly inAppNotificationsService: InAppNotificationsService,
    appLogger: AppLogger,
    private readonly dataSource?: DataSource,
  ) {
    this.logger = appLogger.child({ module: EmailNotificationService.name });
  }

  async sendMerchantPaymentReceived(
    to: string,
    merchantName: string | null,
    paymentId: string,
    amount: string,
    currency: string,
    description: string | null,
    merchantId?: string,
  ): Promise<void> {
    if (merchantId && !(await this.prefsService.isEmailEnabled(merchantId, NotificationCategory.PAYMENTS))) {
      return;
    }
    await this.enqueue({
      to,
      subject: `Payment Received: ${amount} ${currency}`,
      templateName: 'merchant-payment-received',
      templateData: {
        merchantName: merchantName || undefined,
        paymentAmount: amount,
        paymentCurrency: currency,
        paymentId,
        paymentDescription: description || undefined,
      },
      eventType: EmailEventType.PAYMENT_RECEIVED,
      recipientRole: 'merchant',
      paymentId,
    });
    if (merchantId) {
      await this.inAppNotificationsService.create({
        userId: merchantId,
        type: InAppNotificationType.PAYMENT_RECEIVED,
        title: `Payment Received: ${amount} ${currency}`,
        body: description ? `Payment ${paymentId} — ${description}` : `Payment ${paymentId} received`,
        link: `/payments/${paymentId}`,
      });
    }
  }

  async sendMerchantVolumeLimitWarning(
    to: string,
    currency: string,
    limitType: string,
    limit: number,
    currentVolume: number,
  ): Promise<void> {
    await this.enqueue({
      to,
      subject: `Volume limit warning: ${currency}`,
      templateName: 'merchant-volume-limit-warning',
      templateData: {
        currency,
        limitType,
        limit: limit.toFixed(2),
        currentVolume: currentVolume.toFixed(2),
      },
      eventType: EmailEventType.PAYMENT_RECEIVED,
      recipientRole: 'merchant',
    });
  }

  async sendMerchantRefundIssued(
    to: string,
    merchantName: string | null,
    paymentId: string,
    refundId: string,
    refundAmount: string,
    paymentAmount: string,
    currency: string,
    reason: string | null,
    merchantId?: string,
  ): Promise<void> {
    if (merchantId && !(await this.prefsService.isEmailEnabled(merchantId, NotificationCategory.REFUNDS))) {
      return;
    }
    await this.enqueue({
      to,
      subject: `Refund Issued: ${refundAmount} ${currency}`,
      templateName: 'merchant-refund-issued',
      templateData: {
        merchantName: merchantName || undefined,
        paymentAmount: paymentAmount,
        paymentCurrency: currency,
        paymentId,
        refundId,
        refundAmount,
        refundReason: reason || undefined,
      },
      eventType: EmailEventType.REFUND_ISSUED,
      recipientRole: 'merchant',
      paymentId,
      refundId,
    });
    if (merchantId) {
      await this.inAppNotificationsService.create({
        userId: merchantId,
        type: InAppNotificationType.REFUND_ISSUED,
        title: `Refund Issued: ${refundAmount} ${currency}`,
        body: reason ? `Refund ${refundId} for payment ${paymentId} — ${reason}` : `Refund ${refundId} issued for payment ${paymentId}`,
        link: `/payments/${paymentId}`,
      });
    }
  }

  async sendMerchantDisputeOpened(
    to: string,
    merchantName: string | null,
    paymentId: string,
    disputeId: string,
    amount: string,
    currency: string,
    reason: string | null,
    merchantId?: string,
  ): Promise<void> {
    if (merchantId && !(await this.prefsService.isEmailEnabled(merchantId, NotificationCategory.DISPUTES))) {
      return;
    }
    await this.enqueue({
      to,
      subject: `Dispute Opened: ${amount} ${currency}`,
      templateName: 'merchant-dispute-opened',
      templateData: {
        merchantName: merchantName || undefined,
        paymentAmount: amount,
        paymentCurrency: currency,
        paymentId,
        disputeId,
        disputeReason: reason || undefined,
      },
      eventType: EmailEventType.DISPUTE_OPENED,
      recipientRole: 'merchant',
      paymentId,
    });
    if (merchantId) {
      await this.inAppNotificationsService.create({
        userId: merchantId,
        type: InAppNotificationType.DISPUTE_OPENED,
        title: `Dispute Opened: ${amount} ${currency}`,
        body: reason ? `Dispute ${disputeId} on payment ${paymentId} — ${reason}` : `Dispute ${disputeId} opened on payment ${paymentId}`,
        link: `/payments/${paymentId}/disputes/${disputeId}`,
      });
    }
  }

  async sendDisputeResponseReminder(
    to: string,
    data: { disputeId: string; paymentId: string; respondBy: Date; daysRemaining: number },
  ): Promise<void> {
    await this.enqueue({
      to,
      subject: `Dispute response due in ${data.daysRemaining} day${data.daysRemaining === 1 ? '' : 's'}`,
      templateName: 'dispute-response-reminder',
      templateData: {
        ...data,
        respondBy: formatDate(data.respondBy),
      },
      eventType: EmailEventType.DISPUTE_RESPONSE_REMINDER,
      recipientRole: 'merchant',
      paymentId: data.paymentId,
    });
  }

  async sendDisputeEscalatedNotice(
    to: string,
    data: { disputeId: string; paymentId: string; respondBy: Date },
  ): Promise<void> {
    await this.enqueue({
      to,
      subject: `Dispute ${data.disputeId} escalated`,
      templateName: 'dispute-escalated',
      templateData: {
        ...data,
        respondBy: formatDate(data.respondBy),
      },
      eventType: EmailEventType.DISPUTE_ESCALATED,
      recipientRole: 'admin',
      paymentId: data.paymentId,
    });
  }

  async sendPayerDisputeOpened(
    to: string,
    payerName: string | null,
    paymentId: string,
    disputeId: string,
    amount: string,
    currency: string,
    reason: string | null,
    locale?: string | null,
  ): Promise<void> {
    const formattedAmount = formatMoney(amount, currency, locale);
    await this.enqueue({
      to,
      subject: translate(locale, 'subject.disputeOpened', { amount: formattedAmount }),
      templateName: 'payer-dispute-opened',
      templateData: {
        payerName: payerName || undefined,
        paymentAmount: amount,
        paymentCurrency: currency,
        formattedAmount,
        paymentId,
        disputeId,
        disputeReason: reason || undefined,
      },
      eventType: EmailEventType.DISPUTE_OPENED,
      recipientRole: 'payer',
      paymentId,
      includeUnsubscribe: true,
      locale,
    });
  }

  async sendMerchantDisputeStatusChanged(
    to: string,
    merchantName: string | null,
    paymentId: string,
    disputeId: string,
    amount: string,
    currency: string,
    previousStatus: string,
    newStatus: string,
    resolutionNotes: string | null,
  ): Promise<void> {
    await this.enqueue({
      to,
      subject: `Dispute Status Updated: ${newStatus}`,
      templateName: 'merchant-dispute-status-changed',
      templateData: {
        merchantName: merchantName || undefined,
        paymentAmount: amount,
        paymentCurrency: currency,
        paymentId,
        disputeId,
        previousStatus,
        newStatus,
        resolutionNotes: resolutionNotes || undefined,
      },
      eventType: EmailEventType.DISPUTE_STATUS_CHANGED,
      recipientRole: 'merchant',
      paymentId,
    });
  }

  async sendPayerDisputeStatusChanged(
    to: string,
    payerName: string | null,
    paymentId: string,
    disputeId: string,
    amount: string,
    currency: string,
    previousStatus: string,
    newStatus: string,
    resolutionNotes: string | null,
    locale?: string | null,
  ): Promise<void> {
    await this.enqueue({
      to,
      subject: translate(locale, 'subject.disputeStatusChanged', { status: newStatus }),
      templateName: 'payer-dispute-status-changed',
      templateData: {
        payerName: payerName || undefined,
        paymentAmount: amount,
        paymentCurrency: currency,
        formattedAmount: formatMoney(amount, currency, locale),
        paymentId,
        disputeId,
        previousStatus,
        newStatus,
        resolutionNotes: resolutionNotes || undefined,
      },
      eventType: EmailEventType.DISPUTE_STATUS_CHANGED,
      recipientRole: 'payer',
      paymentId,
      includeUnsubscribe: true,
      locale,
    });
  }

  async sendPayerPaymentConfirmed(
    to: string,
    payerName: string | null,
    paymentId: string,
    amount: string,
    currency: string,
    description: string | null,
    locale?: string | null,
  ): Promise<void> {
    const formattedAmount = formatMoney(amount, currency, locale);
    await this.enqueue({
      to,
      subject: translate(locale, 'subject.paymentConfirmed', { amount: formattedAmount }),
      templateName: 'payer-payment-confirmed',
      templateData: {
        payerName: payerName || undefined,
        paymentAmount: amount,
        paymentCurrency: currency,
        formattedAmount,
        paymentId,
        paymentDescription: description || undefined,
        date: formatDate(new Date(), locale),
      },
      eventType: EmailEventType.PAYMENT_CONFIRMED,
      recipientRole: 'payer',
      paymentId,
      includeUnsubscribe: true,
      locale,
    });
  }

  async sendPayerRefundProcessed(
    to: string,
    payerName: string | null,
    paymentId: string,
    refundId: string,
    refundAmount: string,
    currency: string,
    reason: string | null,
    locale?: string | null,
  ): Promise<void> {
    const formattedRefundAmount = formatMoney(refundAmount, currency, locale);
    await this.enqueue({
      to,
      subject: translate(locale, 'subject.refundProcessed', { amount: formattedRefundAmount }),
      templateName: 'payer-refund-processed',
      templateData: {
        payerName: payerName || undefined,
        paymentAmount: '', // not needed for payer
        paymentCurrency: currency,
        paymentId,
        refundId,
        refundAmount,
        formattedRefundAmount,
        refundReason: reason || undefined,
      },
      eventType: EmailEventType.REFUND_PROCESSED,
      recipientRole: 'payer',
      paymentId,
      refundId,
      includeUnsubscribe: true,
      locale,
    });
  }

  async sendPayerRecurringPaymentReminder(
    to: string,
    payerName: string | null,
    planId: string,
    amount: string,
    currency: string,
    chargeDate: Date,
    merchantEmail: string,
    manageUrl: string,
    cancelUrl: string,
    description: string | null,
    locale?: string | null,
  ): Promise<void> {
    const formattedDate = formatDate(chargeDate, locale, {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
    const formattedAmount = formatMoney(amount, currency, locale);

    await this.enqueue({
      to,
      subject: translate(locale, 'subject.recurringReminder', {
        amount: formattedAmount,
        date: formattedDate,
      }),
      templateName: 'payer-recurring-payment-reminder',
      templateData: {
        payerName: payerName || undefined,
        paymentAmount: amount,
        paymentCurrency: currency,
        formattedAmount,
        chargeDate: formattedDate,
        merchantEmail,
        manageUrl,
        cancelUrl,
        planDescription: description || undefined,
      },
      eventType: EmailEventType.PAYMENT_CONFIRMED,
      recipientRole: 'payer',
      paymentId: planId,
      includeUnsubscribe: true,
      locale,
    });
  }

  async sendWebhookEndpointDisabled(
    to: string,
    endpointUrl: string,
    consecutiveFailures: number,
    lastError: string,
    reenableUrl: string,
  ): Promise<void> {
    await this.enqueue({
      to,
      subject: `Webhook Endpoint Disabled: ${endpointUrl}`,
      templateName: 'merchant-webhook-endpoint-disabled',
      templateData: {
        endpointUrl,
        consecutiveFailures,
        lastError,
        reenableUrl,
      },
      eventType: EmailEventType.PAYMENT_RECEIVED,
      recipientRole: 'merchant',
    });
  }

  async sendApiKeyExpiryWarning(data: {
    to: string;
    keyName: string;
    keyPrefix: string;
    expiresAt: Date;
    daysUntilExpiry: number;
    rotateUrl: string;
    apiKeyId: string;
  }): Promise<void> {
    await this.enqueue(
      {
        to: data.to,
        subject: `API key expires in ${data.daysUntilExpiry} days`,
        templateName: 'api-key-expiry-warning',
        templateData: {
          keyName: data.keyName,
          keyPrefix: data.keyPrefix,
          expiryDate: data.expiresAt.toISOString().slice(0, 10),
          daysUntilExpiry: data.daysUntilExpiry,
          rotateUrl: data.rotateUrl,
        },
        eventType: EmailEventType.API_KEY_EXPIRING,
        recipientRole: 'merchant',
      },
      `api-key-expiry-${data.apiKeyId}-${data.daysUntilExpiry}`,
    );
  }

  async sendMerchantReport(
    to: string,
    summary: ReportSummary,
    subscriptionId: string,
    csvContent?: string,
    merchantId?: string,
  ): Promise<void> {
    if (merchantId && !(await this.prefsService.isEmailEnabled(merchantId, NotificationCategory.REPORTS))) {
      return;
    }
    const periodLabel = summary.periodStart.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
    const periodEnd = summary.periodEnd.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });

    const attachments = csvContent
      ? [
          {
            filename: `report-${summary.periodStart.toISOString().slice(0, 10)}.csv`,
            content: csvContent,
            contentType: 'text/csv',
          },
        ]
      : undefined;

    await this.enqueue({
      to,
      subject: `Your ${summary.frequency.toLowerCase()} FacilPay report — ${periodLabel}`,
      templateName: 'merchant-report-summary',
      templateData: {
        frequency: summary.frequency,
        periodStart: periodLabel,
        periodEnd,
        totalPayments: summary.totalPayments,
        completedPayments: summary.completedPayments,
        totalVolume: summary.totalVolume.toFixed(2),
        totalFees: summary.totalFees.toFixed(2),
        totalNetAmount: summary.totalNetAmount.toFixed(2),
        totalRefunds: summary.totalRefunds.toFixed(2),
        refundCount: summary.refundCount,
        currency: summary.currency,
        subscriptionId,
        attachments,
      },
      eventType: EmailEventType.PAYMENT_RECEIVED,
      recipientRole: 'merchant',
      includeUnsubscribe: true,
    });
  }

  private async enqueue(data: SendEmailJobData, jobId?: string): Promise<void> {
    await this.emailQueue.add('send', data, {
      ...(jobId ? { jobId } : {}),
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 1000,
      },
      removeOnComplete: jobId ? { age: 30 * 24 * 60 * 60 } : true,
      removeOnFail: false,
    });
  }

  /**
   * Send invoice reminder email with merchant branding
   */
  async sendInvoiceReminder(
    to: string,
    branding: {
      displayName: string;
      logo: string | null;
      primaryColor: string;
      supportEmail: string | null;
      supportUrl: string | null;
    },
    data: {
      paymentId: string;
      amount: string;
      currency: string;
      dueDate: string;
      reminderType: 'BEFORE' | 'ON_DUE' | 'AFTER';
      daysUntilDue?: number;
      locale?: string | null;
    },
  ): Promise<void> {
    const { locale } = data;
    const suffix = { BEFORE: 'Before', ON_DUE: 'OnDue', AFTER: 'After' }[data.reminderType];
    const subject = translate(locale, `subject.invoice${suffix}`, {
      days: data.daysUntilDue ?? '',
    });
    const previewText = translate(locale, `preview.invoice${suffix}`, {
      merchant: branding.displayName,
    });
    const parsedDueDate = new Date(data.dueDate);
    const dueDate = Number.isNaN(parsedDueDate.getTime())
      ? data.dueDate
      : formatDate(parsedDueDate, locale);

    await this.enqueue({
      to,
      subject,
      templateName: 'invoice-reminder',
      templateData: {
        merchantName: branding.displayName,
        merchantLogo: branding.logo,
        primaryColor: branding.primaryColor,
        supportEmail: branding.supportEmail,
        supportUrl: branding.supportUrl,
        paymentId: data.paymentId,
        amount: data.amount,
        currency: data.currency,
        formattedAmount: formatMoney(data.amount, data.currency, locale),
        dueDate,
        previewText,
      },
      eventType: EmailEventType.PAYMENT_RECEIVED, // Could add new type
      recipientRole: 'payer',
      paymentId: data.paymentId,
      includeUnsubscribe: true,
      locale,
    });
  }

  async sendInvoiceCreated(
    to: string,
    data: {
      invoiceNumber: string;
      customerName: string | null;
      amount: string;
      currency: string;
      dueDate: string;
      payUrl: string;
    },
  ): Promise<void> {
    await this.enqueue({
      to,
      subject: `Invoice ${data.invoiceNumber} from FacilPay`,
      templateName: 'invoice-created',
      templateData: {
        ...data,
        dueDate: formatDate(new Date(data.dueDate)),
        formattedAmount: formatMoney(data.amount, data.currency),
      },
      eventType: EmailEventType.INVOICE_CREATED,
      recipientRole: 'payer',
    });
  }

  /**
   * Send payment confirmation with merchant branding
   */
  async sendPayerPaymentConfirmedWithBranding(
    to: string,
    branding: {
      displayName: string;
      logo: string | null;
      primaryColor: string;
      supportEmail: string | null;
      supportUrl: string | null;
    },
    data: {
      payerName: string | null;
      paymentId: string;
      amount: string;
      currency: string;
      description: string | null;
      locale?: string | null;
    },
  ): Promise<void> {
    const { locale } = data;
    const formattedAmount = formatMoney(data.amount, data.currency, locale);
    await this.enqueue({
      to,
      subject: translate(locale, 'subject.paymentConfirmed', { amount: formattedAmount }),
      templateName: 'payer-payment-confirmed',
      templateData: {
        merchantName: branding.displayName,
        merchantLogo: branding.logo,
        primaryColor: branding.primaryColor,
        supportEmail: branding.supportEmail,
        supportUrl: branding.supportUrl,
        payerName: data.payerName || undefined,
        paymentAmount: data.amount,
        paymentCurrency: data.currency,
        formattedAmount,
        paymentId: data.paymentId,
        paymentDescription: data.description || undefined,
        date: formatDate(new Date(), locale),
      },
      eventType: EmailEventType.PAYMENT_CONFIRMED,
      recipientRole: 'payer',
      paymentId: data.paymentId,
      includeUnsubscribe: true,
      locale,
    });
  }

  async sendRefundApprovalRequested(
    to: string,
    paymentId: string,
    refundId: string,
    amount: string,
    currency: string,
    initiatedBy: string | null,
  ): Promise<void> {
    await this.enqueue({
      to,
      subject: `Refund Approval Required: ${amount} ${currency}`,
      templateName: 'refund-approval-requested',
      templateData: {
        paymentId,
        refundId,
        refundAmount: amount,
        refundCurrency: currency,
        initiatedBy: initiatedBy || 'system',
      },
      eventType: EmailEventType.REFUND_APPROVAL_REQUESTED,
      recipientRole: 'merchant',
      paymentId,
      refundId,
    });
  }

  async sendRefundApprovalOutcome(
    to: string,
    paymentId: string,
    refundId: string,
    amount: string,
    currency: string,
    approved: boolean,
    rejectionReason?: string | null,
  ): Promise<void> {
    const eventType = approved
      ? EmailEventType.REFUND_APPROVED
      : EmailEventType.REFUND_REJECTED;
    await this.enqueue({
      to,
      subject: approved
        ? `Refund Approved: ${amount} ${currency}`
        : `Refund Rejected: ${amount} ${currency}`,
      templateName: approved ? 'refund-approved' : 'refund-rejected',
      templateData: {
        paymentId,
        refundId,
        refundAmount: amount,
        refundCurrency: currency,
        rejectionReason: rejectionReason || undefined,
      },
      eventType,
      recipientRole: 'merchant',
      paymentId,
      refundId,
    });
  }

  async sendDailyDigestEmail(
    to: string,
    summary: DailyDigestSummary,
  ): Promise<boolean> {
    const dedupeKey = `${summary.userId}:${summary.localDate}`;
    if (this.sentDigestKeys.has(dedupeKey)) {
      return false;
    }
    this.sentDigestKeys.add(dedupeKey);

    const subject =
      summary.failureCount > 0
        ? `Daily Notification Digest (${summary.localDate}): ${summary.totalCount} events (${summary.failureCount} attention required)`
        : `Daily Notification Digest (${summary.localDate}): ${summary.totalCount} events`;

    await this.enqueue({
      to,
      subject,
      templateName: 'daily-digest',
      templateData: {
        localDate: summary.localDate,
        timezone: summary.timezone,
        totalCount: summary.totalCount,
        countsByType: summary.countsByType,
        failureCount: summary.failureCount,
        failures: summary.failures,
      },
      eventType: EmailEventType.DAILY_DIGEST,
      recipientRole: 'merchant',
    });

    return true;
  }

  @Cron(CronExpression.EVERY_HOUR)
  async runScheduledDailyDigests(
    now: Date = new Date(),
    targetLocalHour = 8,
  ): Promise<number> {
    if (!this.dataSource) {
      return 0;
    }

    const userIds = await this.prefsService.listDigestSubscribers();
    if (userIds.length === 0) {
      return 0;
    }

    let sentCount = 0;
    const since = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    for (const userId of userIds) {
      const [userRow] = await this.dataSource.query(
        `SELECT u."id", u."email", COALESCE(ms."timezone", 'UTC') AS "timezone"
           FROM "users" u
           LEFT JOIN "merchant_settings" ms ON ms."merchantId" = u."id"
          WHERE u."id" = $1`,
        [userId],
      );
      if (!userRow?.email) {
        continue;
      }

      const timezone = userRow.timezone || 'UTC';
      const { localDate, hour } = getLocalDateAndHour(now, timezone);
      if (hour !== targetLocalHour) {
        continue;
      }

      const dedupeKey = `${userId}:${localDate}`;
      if (this.sentDigestKeys.has(dedupeKey)) {
        continue;
      }

      const items: Pick<
        InAppNotification,
        'id' | 'type' | 'title' | 'body' | 'createdAt'
      >[] = await this.dataSource.query(
        `SELECT "id", "type", "title", "body", "createdAt"
           FROM "in_app_notifications"
          WHERE "userId" = $1 AND "createdAt" >= $2
          ORDER BY "createdAt" DESC`,
        [userId, since],
      );

      if (items.length === 0) {
        continue;
      }

      const summary = summarizeDigestNotifications(
        userId,
        localDate,
        timezone,
        items,
      );
      const sent = await this.sendDailyDigestEmail(userRow.email, summary);
      if (sent) {
        sentCount += 1;
      }
    }

    return sentCount;
  }
}

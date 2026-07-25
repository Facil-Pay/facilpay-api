import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { AppLogger } from '../logger/logger.service';
import { Logger } from 'pino';
import { EmailEventType } from './email-log.entity';
import { SendEmailJobData } from './email.processor';

@Injectable()
export class EmailNotificationService {
  private readonly logger: Logger;

  constructor(
    @InjectQueue('emails') private readonly emailQueue: Queue,
    appLogger: AppLogger,
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
  ): Promise<void> {
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
  ): Promise<void> {
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
  }

  async sendMerchantDisputeOpened(
    to: string,
    merchantName: string | null,
    paymentId: string,
    disputeId: string,
    amount: string,
    currency: string,
    reason: string | null,
  ): Promise<void> {
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
  }

  async sendPayerPaymentConfirmed(
    to: string,
    payerName: string | null,
    paymentId: string,
    amount: string,
    currency: string,
    description: string | null,
  ): Promise<void> {
    await this.enqueue({
      to,
      subject: `Payment Confirmed: ${amount} ${currency}`,
      templateName: 'payer-payment-confirmed',
      templateData: {
        payerName: payerName || undefined,
        paymentAmount: amount,
        paymentCurrency: currency,
        paymentId,
        paymentDescription: description || undefined,
        date: new Date().toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        }),
      },
      eventType: EmailEventType.PAYMENT_CONFIRMED,
      recipientRole: 'payer',
      paymentId,
      includeUnsubscribe: true,
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
  ): Promise<void> {
    await this.enqueue({
      to,
      subject: `Refund Processed: ${refundAmount} ${currency}`,
      templateName: 'payer-refund-processed',
      templateData: {
        payerName: payerName || undefined,
        paymentAmount: '', // not needed for payer
        paymentCurrency: currency,
        paymentId,
        refundId,
        refundAmount,
        refundReason: reason || undefined,
      },
      eventType: EmailEventType.REFUND_PROCESSED,
      recipientRole: 'payer',
      paymentId,
      refundId,
      includeUnsubscribe: true,
    });
  }

  private async enqueue(data: SendEmailJobData): Promise<void> {
    await this.emailQueue.add('send', data, {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 1000,
      },
      removeOnComplete: true,
      removeOnFail: false,
    });
  }
}

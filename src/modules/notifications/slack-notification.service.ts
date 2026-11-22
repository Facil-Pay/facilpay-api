import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppLogger } from '../logger/logger.service';
import { Logger } from 'pino';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

export interface SlackPaymentEventData {
  paymentId: string;
  amount: number;
  currency: string;
  status: string;
  merchantId: string;
  merchantEmail?: string;
  payerEmail?: string;
  payerName?: string;
  description?: string;
  timestamp: Date;
}

@Injectable()
export class SlackNotificationService {
  private readonly logger: Logger;
  private readonly webhookUrl: string | null;
  private readonly enabled: boolean;

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
    appLogger: AppLogger,
  ) {
    this.logger = appLogger.child({ module: SlackNotificationService.name });
    this.webhookUrl = this.configService.get<string>('SLACK_WEBHOOK_URL', null);
    this.enabled = this.configService.get<string>('SLACK_NOTIFICATIONS_ENABLED', 'false') === 'true';

    if (this.enabled && !this.webhookUrl) {
      this.logger.warn('Slack notifications enabled but SLACK_WEBHOOK_URL not configured');
    }
  }

  async sendPaymentNotification(event: SlackPaymentEventData): Promise<void> {
    if (!this.enabled || !this.webhookUrl) {
      this.logger.debug('Slack notifications disabled or not configured');
      return;
    }

    try {
      const message = this.formatPaymentMessage(event);
      await firstValueFrom(
        this.httpService.post(this.webhookUrl, {
          blocks: message,
        }),
      );
      this.logger.info({ paymentId: event.paymentId }, 'Slack notification sent');
    } catch (error) {
      this.logger.error(
        { error, paymentId: event.paymentId },
        'Failed to send Slack notification',
      );
      // Don't throw - notification failure should not break payment flow
    }
  }

  async sendPaymentCompleted(data: SlackPaymentEventData): Promise<void> {
    return this.sendPaymentNotification({
      ...data,
      status: 'COMPLETED',
    });
  }

  async sendPaymentFailed(data: SlackPaymentEventData): Promise<void> {
    return this.sendPaymentNotification({
      ...data,
      status: 'FAILED',
    });
  }

  async sendPaymentRefunded(data: SlackPaymentEventData): Promise<void> {
    return this.sendPaymentNotification({
      ...data,
      status: 'REFUNDED',
    });
  }

  async sendPaymentCancelled(data: SlackPaymentEventData): Promise<void> {
    return this.sendPaymentNotification({
      ...data,
      status: 'CANCELLED',
    });
  }

  private formatPaymentMessage(event: SlackPaymentEventData): any[] {
    const statusEmoji = this.getStatusEmoji(event.status);
    const formattedAmount = `${event.currency} ${event.amount.toFixed(2)}`;
    
    const fields: any[] = [
      {
        type: 'mrkdwn',
        text: `*Payment ID:*\n${event.paymentId}`,
      },
      {
        type: 'mrkdwn',
        text: `*Amount:*\n${formattedAmount}`,
      },
      {
        type: 'mrkdwn',
        text: `*Status:*\n${statusEmoji} ${event.status}`,
      },
    ];

    if (event.merchantEmail) {
      fields.push({
        type: 'mrkdwn',
        text: `*Merchant:*\n${event.merchantEmail}`,
      });
    }

    if (event.payerName || event.payerEmail) {
      const payer = event.payerName 
        ? `${event.payerName}${event.payerEmail ? ` (${event.payerEmail})` : ''}`
        : event.payerEmail;
      fields.push({
        type: 'mrkdwn',
        text: `*Payer:*\n${payer}`,
      });
    }

    if (event.description) {
      fields.push({
        type: 'mrkdwn',
        text: `*Description:*\n${event.description}`,
      });
    }

    return [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: `Payment ${event.status}`,
          emoji: true,
        },
      },
      {
        type: 'section',
        fields,
      },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `<!date^${Math.floor(event.timestamp.getTime() / 1000)}^{date_short_pretty} at {time}|${event.timestamp.toISOString()}>`,
          },
        ],
      },
    ];
  }

  private getStatusEmoji(status: string): string {
    const emojiMap: Record<string, string> = {
      COMPLETED: '✅',
      FAILED: '❌',
      REFUNDED: '↩️',
      CANCELLED: '🚫',
      PENDING: '⏳',
      PARTIALLY_REFUNDED: '↩️',
      EXPIRED: '⌛',
    };
    return emojiMap[status] || '📋';
  }
}

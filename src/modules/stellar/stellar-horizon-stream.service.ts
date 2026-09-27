import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as StellarSdk from '@stellar/stellar-sdk';
import { Payment, PaymentStatus } from '../payments/payment.entity';

@Injectable()
export class StellarHorizonStreamService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(StellarHorizonStreamService.name);
  private readonly server: StellarSdk.Horizon.Server;
  private readonly merchantAccountId: string;
  private streamClose: (() => void) | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private isDestroyed = false;
  private _connected = false;

  private readonly baseDelayMs: number;
  private readonly maxDelayMs: number;
  private currentDelayMs: number;
  private failureCount = 0;

  constructor(
    private readonly configService: ConfigService,
    @InjectRepository(Payment)
    private readonly paymentRepository: Repository<Payment>,
  ) {
    const horizonUrl =
      this.configService.get<string>('STELLAR_HORIZON_URL') ||
      'https://horizon-testnet.stellar.org';
    this.server = new StellarSdk.Horizon.Server(horizonUrl);
    this.merchantAccountId =
      this.configService.get<string>('STELLAR_MERCHANT_ACCOUNT_ID') || '';
    this.baseDelayMs = this.configService.get<number>('STELLAR_RECONNECT_BASE_DELAY_MS', 1000);
    this.maxDelayMs = this.configService.get<number>('STELLAR_RECONNECT_MAX_DELAY_MS', 60000);
    this.currentDelayMs = this.baseDelayMs;
  }

  onModuleInit(): void {
    if (!this.merchantAccountId) {
      this.logger.warn(
        'STELLAR_MERCHANT_ACCOUNT_ID not set — Horizon SSE stream disabled',
      );
      return;
    }
    this.startStream();
  }

  onModuleDestroy(): void {
    this.isDestroyed = true;
    this.closeStream();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  get connected(): boolean {
    return this._connected;
  }

  private startStream(): void {
    try {
      const close = this.server
        .payments()
        .forAccount(this.merchantAccountId)
        .cursor('now')
        .stream({
          onmessage: (record: any) => void this.handleRecord(record),
          onerror: (error: any) => {
            this._connected = false;
            this.logger.error(
              { err: error instanceof Error ? error : new Error(String(error)) },
              'Horizon SSE stream error — scheduling reconnect',
            );
            this.closeStream();
            this.scheduleReconnect();
          },
        }) as unknown as () => void;

      this.streamClose = close;
      this._connected = true;
      this.failureCount = 0;
      this.currentDelayMs = this.baseDelayMs;
      this.logger.log(
        `Horizon SSE stream started for account ${this.merchantAccountId}`,
      );
    } catch (error) {
      this._connected = false;
      this.logger.error(
        { err: error instanceof Error ? error : new Error(String(error)) },
        'Failed to start Horizon SSE stream — scheduling reconnect',
      );
      this.scheduleReconnect();
    }
  }

  private closeStream(): void {
    if (this.streamClose) {
      try {
        this.streamClose();
      } catch {
        // ignore close errors
      }
      this.streamClose = null;
    }
    this._connected = false;
  }

  private scheduleReconnect(): void {
    if (this.isDestroyed) return;
    const jitter = Math.random() * this.currentDelayMs;
    const delay = Math.min(this.currentDelayMs + jitter, this.maxDelayMs);
    this.failureCount += 1;
    this.currentDelayMs = Math.min(this.baseDelayMs * 2 ** this.failureCount, this.maxDelayMs);
    this.reconnectTimer = setTimeout(() => {
      if (!this.isDestroyed) {
        this.logger.log('Reconnecting to Horizon SSE stream...');
        this.startStream();
      }
    }, delay);
  }

  private async handleRecord(record: any): Promise<void> {
    if (record.type !== 'payment') return;

    const destination: string = record.to ?? '';
    if (destination !== this.merchantAccountId) return;

    const amount: string = record.amount ?? '0';
    let memo: string | null = null;

    try {
      const tx = await record.transaction();
      memo = tx.memo ?? null;
    } catch {
      this.logger.warn(
        { hash: record.transaction_hash },
        'Could not fetch transaction memo — matching by amount only',
      );
    }

    const payment = await this.findMatch(amount, memo);

    if (payment) {
      await this.confirmPayment(payment, record.transaction_hash ?? record.id);
    } else {
      this.logger.warn(
        {
          amount,
          memo,
          hash: record.transaction_hash,
          from: record.from,
        },
        'Unmatched Stellar transaction — no pending payment found for amount+memo',
      );
    }
  }

  private async findMatch(
    amount: string,
    memo: string | null,
  ): Promise<Payment | null> {
    const amountNum = parseFloat(amount);
    if (isNaN(amountNum) || !memo) return null;

    const payment = await this.paymentRepository.findOne({
      where: {
        status: PaymentStatus.PENDING,
        externalReference: memo,
      },
    });

    if (!payment) return null;

    const expected = Number(payment.amount);
    if (amountNum < expected - 0.001) {
      this.logger.warn(
        { expected, received: amountNum, memo },
        'Memo matched but amount underpaid — transaction not auto-confirmed',
      );
      return null;
    }

    return payment;
  }

  private async confirmPayment(
    payment: Payment,
    transactionHash: string,
  ): Promise<void> {
    try {
      const received = Number(payment.receivedAmount ?? payment.amount);
      const expected = Number(payment.amount);
      const overpaid = received - expected;

      payment.status = PaymentStatus.COMPLETED;
      if (!payment.externalReference) {
        payment.externalReference = transactionHash;
      }

      if (overpaid > 0.001) {
        payment.overpaidAmount = overpaid;
        this.logger.warn(
          { paymentId: payment.id, expected, received, overpaid },
          'Overpayment detected on Stellar payment',
        );
      }

      await this.paymentRepository.save(payment);
      this.logger.log(
        { paymentId: payment.id, transactionHash },
        'Payment auto-confirmed via Horizon SSE stream',
      );
    } catch (error) {
      this.logger.error(
        {
          err: error instanceof Error ? error : new Error(String(error)),
          paymentId: payment.id,
          transactionHash,
        },
        'Failed to auto-confirm payment from Horizon stream',
      );
    }
  }
}

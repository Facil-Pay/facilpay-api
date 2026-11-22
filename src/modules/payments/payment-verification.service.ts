import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import * as StellarSdk from '@stellar/stellar-sdk';
import { Payment, PaymentStatus } from './payment.entity';
import { PaymentVerificationLog } from './entities/payment-verification-log.entity';
import { StellarHorizonClientService } from '../stellar/stellar-horizon-client.service';
import { AppLogger } from '../logger/logger.service';
import { Logger } from 'pino';

/** A single field-level mismatch found during verification. */
export interface VerificationMismatch {
  field: 'destination' | 'assetCode' | 'amount' | 'memo';
  expected: string;
  actual: string | null;
}

/** The structured result returned to the caller. */
export interface TransactionVerificationResult {
  /** true when every required field matches */
  matched: boolean;
  mismatches: VerificationMismatch[];
  /** Whether the payment was completed as a result of this call */
  paymentCompleted: boolean;
  transactionHash: string;
  onChain: {
    destination: string | null;
    assetCode: string | null;
    amount: string | null;
    memo: string | null;
    from: string | null;
    createdAt: string | null;
  };
}

/** Tolerance applied when comparing amounts (Stellar 7-decimal precision). */
const AMOUNT_TOLERANCE = 0.0000001;

@Injectable()
export class PaymentVerificationService {
  private readonly logger: Logger;
  private readonly merchantAccountId: string;

  constructor(
    @InjectRepository(Payment)
    private readonly paymentRepo: Repository<Payment>,
    @InjectRepository(PaymentVerificationLog)
    private readonly logRepo: Repository<PaymentVerificationLog>,
    private readonly horizonClient: StellarHorizonClientService,
    private readonly configService: ConfigService,
    appLogger: AppLogger,
  ) {
    this.logger = appLogger.child({ module: PaymentVerificationService.name });
    this.merchantAccountId =
      this.configService.get<string>('STELLAR_MERCHANT_ACCOUNT_ID') ?? '';
  }

  /**
   * Fetches the given transaction from Horizon and compares its destination,
   * asset, amount and memo against the stored payment.
   *
   * @param paymentId       - Our internal payment UUID
   * @param txHash          - Stellar transaction hash supplied by the payer
   * @param completeOnMatch - When true, complete a PENDING payment if all fields match
   * @param requestedBy     - Actor ID for the audit log (optional)
   */
  async verifyTransaction(
    paymentId: string,
    txHash: string,
    completeOnMatch: boolean,
    requestedBy?: string,
  ): Promise<TransactionVerificationResult> {
    const payment = await this.paymentRepo.findOneBy({ id: paymentId });
    if (!payment) {
      throw new NotFoundException(`Payment ${paymentId} not found`);
    }

    // Fetch the transaction and all its payment operations from Horizon
    const server = this.horizonClient.getHealthyServer();

    let txRecord: StellarSdk.Horizon.ServerApi.TransactionRecord;
    try {
      txRecord = await server.transactions().transaction(txHash).call() as unknown as StellarSdk.Horizon.ServerApi.TransactionRecord;
    } catch (err: any) {
      if (err?.response?.status === 404 || err?.status === 404) {
        throw new BadRequestException(
          `Transaction ${txHash} was not found on the Stellar network`,
        );
      }
      throw new BadRequestException(
        `Could not fetch transaction from Horizon: ${err?.message ?? String(err)}`,
      );
    }

    // Pull the payment operations for this transaction
    let ops: any[];
    try {
      const opsPage = await server
        .operations()
        .forTransaction(txHash)
        .call();
      ops = opsPage.records ?? [];
    } catch {
      ops = [];
    }

    // Find the first payment operation directed at the merchant account
    const merchantDest = this.merchantAccountId;
    const paymentOp = ops.find(
      (op) =>
        op.type === 'payment' &&
        (op.to === merchantDest ||
          // muxed-account recipient: compare the base account
          (op.to_muxed_id !== undefined && this.demux(op.to ?? '') === merchantDest)),
    );

    // Fetch the memo from the transaction envelope
    let memo: string | null = null;
    try {
      const envelope = StellarSdk.TransactionBuilder.fromXDR(
        (txRecord as any).envelope_xdr,
        this.horizonClient['configService']?.get?.('STELLAR_NETWORK') === 'PUBLIC'
          ? StellarSdk.Networks.PUBLIC
          : StellarSdk.Networks.TESTNET,
      );
      const rawMemo = (envelope as any).memo;
      if (rawMemo && rawMemo.type !== 'none' && rawMemo.value) {
        memo = typeof rawMemo.value === 'string'
          ? rawMemo.value
          : rawMemo.value.toString('utf8');
      }
    } catch {
      // If we cannot decode the envelope, fall back to the tx-level memo field
      memo = (txRecord as any).memo ?? null;
    }

    const onChain = {
      destination: paymentOp?.to ?? null,
      assetCode: paymentOp
        ? paymentOp.asset_type === 'native'
          ? 'XLM'
          : (paymentOp.asset_code ?? null)
        : null,
      amount: paymentOp?.amount ?? null,
      memo,
      from: paymentOp?.from ?? (txRecord as any).source_account ?? null,
      createdAt: (txRecord as any).created_at ?? null,
    };

    const mismatches = this.compareFields(payment, onChain, merchantDest);
    const matched = mismatches.length === 0;

    let paymentCompleted = false;

    if (matched && completeOnMatch) {
      if (payment.status === PaymentStatus.PENDING) {
        payment.status = PaymentStatus.COMPLETED;
        if (!payment.externalReference) {
          payment.externalReference = txHash;
        }
        await this.paymentRepo.save(payment);
        paymentCompleted = true;

        this.logger.info(
          { paymentId, txHash },
          'Payment completed via manual transaction verification',
        );
      } else if (payment.status !== PaymentStatus.COMPLETED) {
        // Silently skip: payment is in a terminal state other than COMPLETED
        this.logger.info(
          { paymentId, status: payment.status },
          'completeOnMatch requested but payment is not PENDING — skipping',
        );
      }
    }

    this.logger.info(
      {
        paymentId,
        txHash,
        matched,
        mismatchCount: mismatches.length,
        completeOnMatch,
        paymentCompleted,
      },
      'Transaction verification completed',
    );

    // Persist audit log — fire-and-forget so a DB error never blocks the response
    this.logRepo
      .save(
        this.logRepo.create({
          paymentId,
          transactionHash: txHash,
          matched,
          mismatches,
          paymentCompleted,
          requestedBy: requestedBy ?? null,
        }),
      )
      .catch((err) =>
        this.logger.error({ err, paymentId, txHash }, 'Failed to persist verification log'),
      );

    return {
      matched,
      mismatches,
      paymentCompleted,
      transactionHash: txHash,
      onChain,
    };
  }

  // ── comparison helpers ─────────────────────────────────────────────────────

  private compareFields(
    payment: Payment,
    onChain: TransactionVerificationResult['onChain'],
    merchantAccountId: string,
  ): VerificationMismatch[] {
    const mismatches: VerificationMismatch[] = [];

    // 1. Destination must be the merchant's Stellar account
    if (!merchantAccountId) {
      // If no account is configured, we cannot validate destination
    } else {
      const actualDest = onChain.destination
        ? this.demux(onChain.destination)
        : null;
      if (actualDest !== merchantAccountId) {
        mismatches.push({
          field: 'destination',
          expected: merchantAccountId,
          actual: onChain.destination,
        });
      }
    }

    // 2. Asset code must match the payment currency
    // Treat XLM / native as equivalent
    const expectedAsset = payment.currency.toUpperCase();
    const actualAsset = onChain.assetCode?.toUpperCase() ?? null;
    if (actualAsset !== expectedAsset) {
      mismatches.push({
        field: 'assetCode',
        expected: expectedAsset,
        actual: actualAsset,
      });
    }

    // 3. Amount must be >= payment amount (within tolerance)
    const expectedAmount = Number(payment.amount);
    const actualAmount = onChain.amount !== null ? Number(onChain.amount) : null;
    if (actualAmount === null || actualAmount < expectedAmount - AMOUNT_TOLERANCE) {
      mismatches.push({
        field: 'amount',
        expected: String(payment.amount),
        actual: onChain.amount,
      });
    }

    // 4. Memo must match externalReference when one is set
    if (payment.externalReference) {
      const expectedMemo = payment.externalReference;
      const actualMemo = onChain.memo;
      if (actualMemo !== expectedMemo) {
        mismatches.push({
          field: 'memo',
          expected: expectedMemo,
          actual: actualMemo,
        });
      }
    }

    return mismatches;
  }

  /** Extract the base G... address from a muxed M... address. */
  private demux(address: string): string {
    try {
      if ((StellarSdk.StrKey as any).isValidMuxedAccount(address)) {
        return StellarSdk.MuxedAccount.fromAddress(address, '0').accountId();
      }
    } catch {
      // fall through
    }
    return address;
  }
}

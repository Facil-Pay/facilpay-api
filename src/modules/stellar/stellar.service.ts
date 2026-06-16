import { Injectable, Logger, InternalServerErrorException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as StellarSdk from '@stellar/stellar-sdk';
import { CircuitBreakerService } from '../circuit-breaker/circuit-breaker.service';
import { withTimeout } from '../../common/utils/with-timeout';

const CIRCUIT_NAME = 'stellar-horizon';
const REQUEST_TIMEOUT_MS = 30_000;

@Injectable()
export class StellarService {
  private readonly logger = new Logger(StellarService.name);
  private readonly server: StellarSdk.Horizon.Server;
  private readonly networkPassphrase: string;
  private readonly sourceKeypair: StellarSdk.Keypair;

  constructor(
    private configService: ConfigService,
    private readonly circuitBreaker: CircuitBreakerService,
  ) {
    const horizonUrl = this.configService.get<string>('STELLAR_HORIZON_URL');
    const network = this.configService.get<string>('STELLAR_NETWORK');
    const secret = this.configService.get<string>('STELLAR_SOURCE_SECRET');

    if (!horizonUrl || !secret) {
      throw new Error(
        'Stellar configuration is missing. Check STELLAR_HORIZON_URL and STELLAR_SOURCE_SECRET in .env',
      );
    }

    this.server = new StellarSdk.Horizon.Server(horizonUrl);
    this.networkPassphrase =
      network === 'PUBLIC'
        ? StellarSdk.Networks.PUBLIC
        : StellarSdk.Networks.TESTNET;

    this.sourceKeypair = StellarSdk.Keypair.fromSecret(secret);
  }

  async sendPayment(destination: string, amount: string, memo?: string) {
    return this.circuitBreaker.execute(
      CIRCUIT_NAME,
      () => withTimeout(this.doSendPayment(destination, amount, memo), REQUEST_TIMEOUT_MS, 'Stellar sendPayment'),
      { failureThreshold: 3, timeout: 120_000 },
    );
  }

  private async doSendPayment(destination: string, amount: string, memo?: string) {
    try {
      const sourceAccount = await this.server.loadAccount(
        this.sourceKeypair.publicKey(),
      );

      let transactionBuilder = new StellarSdk.TransactionBuilder(
        sourceAccount,
        {
          fee: this.configService.get<string>('STELLAR_BASE_FEE', '100'),
          networkPassphrase: this.networkPassphrase,
        },
      )
        .addOperation(
          StellarSdk.Operation.payment({
            destination,
            asset: StellarSdk.Asset.native(),
            amount,
          }),
        )
        .setTimeout(30);

      if (memo) {
        transactionBuilder = transactionBuilder.addMemo(
          StellarSdk.Memo.text(memo),
        );
      }

      const transaction = transactionBuilder.build();
      transaction.sign(this.sourceKeypair);

      const response = await this.server.submitTransaction(transaction);

      this.logger.log(`Payment successful: ${response.hash}`);
      return {
        hash: response.hash,
        ledger: response.ledger,
      };
    } catch (error) {
      this.handleStellarError(error);
    }
  }

  private handleStellarError(error: unknown): never {
    const err = error as { response?: { data?: { extras?: { result_codes?: { operations?: string[]; transaction?: string }; }; detail?: string; }; }; message?: string };
    const resultCodes = err.response?.data?.extras?.result_codes;
    this.logger.error('Stellar Transaction Failed', resultCodes || err.message);

    if (resultCodes) {
      if (
        resultCodes.operations?.includes('op_low_reserve') ||
        resultCodes.transaction === 'tx_insufficient_balance'
      ) {
        throw new BadRequestException('Insufficient Stellar account balance.');
      }
      if (resultCodes.transaction === 'tx_bad_seq') {
        throw new InternalServerErrorException(
          'Transaction sequence mismatch. Please retry.',
        );
      }
    }

    throw new InternalServerErrorException(
      err.response?.data?.detail || 'Blockchain transaction failed',
    );
  }
}

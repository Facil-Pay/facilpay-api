import { Injectable, Logger, InternalServerErrorException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as StellarSdk from '@stellar/stellar-sdk';

@Injectable()
export class StellarService {
  private readonly logger = new Logger(StellarService.name);
  private readonly server: StellarSdk.Horizon.Server;
  private readonly networkPassphrase: string;
  private readonly sourceKeypair: StellarSdk.Keypair;

  constructor(private configService: ConfigService) {
  const horizonUrl = this.configService.get<string>('STELLAR_HORIZON_URL');
  const network = this.configService.get<string>('STELLAR_NETWORK');
  const secret = this.configService.get<string>('STELLAR_SOURCE_SECRET');

  // Throw an error if config is missing
  if (!horizonUrl || !secret) {
    throw new Error('Stellar configuration is missing. Check STELLAR_HORIZON_URL and STELLAR_SOURCE_SECRET in .env');
  }

  this.server = new StellarSdk.Horizon.Server(horizonUrl);
  this.networkPassphrase = network === 'PUBLIC' 
    ? StellarSdk.Networks.PUBLIC 
    : StellarSdk.Networks.TESTNET;
  
  this.sourceKeypair = StellarSdk.Keypair.fromSecret(secret);
}

  /**
   * Submits a simple XLM payment
   */
  async sendPayment(destination: string, amount: string, memo?: string) {
    try {
      // 1. Load source account to get current sequence number
      const sourceAccount = await this.server.loadAccount(this.sourceKeypair.publicKey());

      // 2. Build the transaction
      let transactionBuilder = new StellarSdk.TransactionBuilder(sourceAccount, {
        fee: this.configService.get<string>('STELLAR_BASE_FEE', '100'),
        networkPassphrase: this.networkPassphrase,
      })
        .addOperation(
          StellarSdk.Operation.payment({
            destination,
            asset: StellarSdk.Asset.native(),
            amount,
          }),
        )
        .setTimeout(30);

      if (memo) {
        transactionBuilder = transactionBuilder.addMemo(StellarSdk.Memo.text(memo));
      }

      const transaction = transactionBuilder.build();

      // 3. Sign the transaction
      transaction.sign(this.sourceKeypair);

      // 4. Submit to Horizon
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

  private handleStellarError(error: any) {
    const resultCodes = error.response?.data?.extras?.result_codes;
    this.logger.error('Stellar Transaction Failed', resultCodes || error.message);

    if (resultCodes) {
      // Mapping common Stellar errors to HTTP responses
      if (resultCodes.operations?.includes('op_low_reserve') || resultCodes.transaction === 'tx_insufficient_balance') {
        throw new BadRequestException('Insufficient Stellar account balance.');
      }
      if (resultCodes.transaction === 'tx_bad_seq') {
        throw new InternalServerErrorException('Transaction sequence mismatch. Please retry.');
      }
    }

    throw new InternalServerErrorException(
      error.response?.data?.detail || 'Blockchain transaction failed',
    );
  }
}
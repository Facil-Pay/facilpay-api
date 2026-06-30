import { Injectable, Logger, InternalServerErrorException, BadRequestException, NotFoundException, Inject, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as StellarSdk from '@stellar/stellar-sdk';
import { MultiSigTransaction, MultiSigTransactionStatus } from './entities/multi-sig-transaction.entity';
import { SignTransactionDto } from './dto/sign-transaction.dto';
import { WebhooksService } from '../webhooks/webhooks.service';

@Injectable()
export class StellarService {
  private readonly logger = new Logger(StellarService.name);
  private readonly server: StellarSdk.Horizon.Server;
  private readonly networkPassphrase: string;
  private readonly sourceKeypair: StellarSdk.Keypair;

  constructor(
    private configService: ConfigService,
    @InjectRepository(MultiSigTransaction)
    private readonly multiSigRepo: Repository<MultiSigTransaction>,
    @Inject(forwardRef(() => WebhooksService))
    private readonly webhooksService: WebhooksService,
  ) {
    const horizonUrl = this.configService.get<string>('STELLAR_HORIZON_URL');
    const network = this.configService.get<string>('STELLAR_NETWORK');
    const secret = this.configService.get<string>('STELLAR_SOURCE_SECRET');

    if (!horizonUrl || !secret) {
      throw new Error('Stellar configuration is missing. Check STELLAR_HORIZON_URL and STELLAR_SOURCE_SECRET in .env');
    }

    this.server = new StellarSdk.Horizon.Server(horizonUrl);
    this.networkPassphrase = network === 'PUBLIC' 
      ? StellarSdk.Networks.PUBLIC 
      : StellarSdk.Networks.TESTNET;
    
    this.sourceKeypair = StellarSdk.Keypair.fromSecret(secret);
  }

  async sendPayment(destination: string, amount: string, memo?: string, merchantId?: string) {
    try {
      const sourceAccount = await this.server.loadAccount(this.sourceKeypair.publicKey());

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
      transaction.sign(this.sourceKeypair);

      const signers = sourceAccount.signers;
      const medThreshold = sourceAccount.thresholds.med_threshold;
      const mySigner = signers.find(s => s.key === this.sourceKeypair.publicKey());
      const myWeight = mySigner ? mySigner.weight : 0;

      const requiresMultiSig = medThreshold > myWeight;

      if (requiresMultiSig) {
        this.logger.log(`Transaction requires multi-sig. Threshold: ${medThreshold}, current weight: ${myWeight}`);
        
        const multiSigTx = this.multiSigRepo.create({
          xdr: transaction.toXDR(),
          sourceAccount: sourceAccount.id,
          requiredSignatures: medThreshold,
          collectedSignatures: myWeight,
          signers: [this.sourceKeypair.publicKey()],
          status: MultiSigTransactionStatus.PENDING_SIGNATURES,
        });
        
        await this.multiSigRepo.save(multiSigTx);
        
        if (merchantId) {
          // Notify relevant signers via webhook
          await this.webhooksService.dispatchEventToMerchant(
            merchantId, 
            'transaction.multisig_required', 
            { transactionId: multiSigTx.id, requiredSignatures: medThreshold, collectedSignatures: myWeight }
          ).catch(e => this.logger.error('Failed to dispatch webhook', e));
        }
        
        return {
          status: 'pending_signatures',
          multiSigTransactionId: multiSigTx.id,
          requiredSignatures: medThreshold,
          collectedSignatures: myWeight,
        };
      }

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

  async signTransaction(id: string, dto: SignTransactionDto, merchantId?: string): Promise<MultiSigTransaction> {
    const multiSigTx = await this.multiSigRepo.findOneBy({ id });
    if (!multiSigTx) {
      throw new NotFoundException(`Multi-sig transaction ${id} not found`);
    }

    if (multiSigTx.status !== MultiSigTransactionStatus.PENDING_SIGNATURES) {
      throw new BadRequestException('Transaction is already submitted or failed');
    }

    if (multiSigTx.signers.includes(dto.publicKey)) {
      throw new BadRequestException('Signer has already signed this transaction');
    }

    try {
      const transaction = new StellarSdk.Transaction(multiSigTx.xdr, this.networkPassphrase);
      
      const signature = Buffer.from(dto.signature, 'base64');
      const hint = new StellarSdk.Keypair({ type: 'ed25519', publicKey: dto.publicKey }).signatureHint();
      
      transaction.addSignature(hint, signature);

      const sourceAccount = await this.server.loadAccount(multiSigTx.sourceAccount);
      const signer = sourceAccount.signers.find(s => s.key === dto.publicKey);
      const weight = signer ? signer.weight : 0;

      if (weight === 0) {
        throw new BadRequestException('Signer is not authorized for this account');
      }

      multiSigTx.xdr = transaction.toXDR();
      multiSigTx.collectedSignatures += weight;
      multiSigTx.signers.push(dto.publicKey);

      if (multiSigTx.collectedSignatures >= multiSigTx.requiredSignatures) {
        this.logger.log(`Threshold reached for tx ${id}. Submitting...`);
        const response = await this.server.submitTransaction(transaction);
        multiSigTx.status = MultiSigTransactionStatus.SUBMITTED;
        multiSigTx.transactionHash = response.hash;
        this.logger.log(`Multi-sig transaction submitted successfully: ${response.hash}`);
        
        if (merchantId) {
          await this.webhooksService.dispatchEventToMerchant(
            merchantId, 
            'transaction.multisig_completed', 
            { transactionId: multiSigTx.id, hash: response.hash }
          ).catch(e => this.logger.error('Failed to dispatch webhook', e));
        }
      }

      return this.multiSigRepo.save(multiSigTx);
    } catch (error: any) {
      this.logger.error('Error signing/submitting multi-sig transaction', error);
      throw new BadRequestException(`Failed to sign/submit: ${error.message}`);
    }
  }

  private handleStellarError(error: any) {
    const resultCodes = error.response?.data?.extras?.result_codes;
    this.logger.error('Stellar Transaction Failed', resultCodes || error.message);

    if (resultCodes) {
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
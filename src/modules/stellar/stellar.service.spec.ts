import { StellarService, parseLowBalanceThresholds } from './stellar.service';

describe('StellarService fee and balance controls', () => {
  const createService = (
    configValues: Record<string, string> = {},
    balances: any[] = [],
  ): StellarService => {
    const service = Object.create(StellarService.prototype) as any;
    service.configService = {
      get: jest.fn((key: string, defaultValue?: string) => configValues[key] ?? defaultValue),
    };
    service.logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
    service.feeStatsCache = null;
    service.lastLowBalanceAlerts = new Map();
    service.lowBalanceHealth = {
      status: 'unknown',
      message: 'not checked',
      lowAssets: [],
      checkedAt: null,
    };
    service.sourceKeypair = { publicKey: () => 'G_PLATFORM_ACCOUNT' };
    service.mailService = { sendLowStellarBalanceAlert: jest.fn().mockResolvedValue(undefined) };
    service.horizonClientService = {
      getHealthyServer: jest.fn(() => ({
        loadAccount: jest.fn().mockResolvedValue({ balances }),
      })),
    };
    return service;
  };

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('parses asset thresholds and ignores malformed entries', () => {
    expect(parseLowBalanceThresholds('XLM:100, usdc:1000,broken,nope:NaN,EUR:-1'))
      .toEqual([
        { assetCode: 'XLM', threshold: 100 },
        { assetCode: 'USDC', threshold: 1000 },
      ]);
  });

  it('uses configured Horizon percentile, clamps it, and caches fee_stats for 30 seconds', async () => {
    const service = createService({
      STELLAR_BASE_FEE: '100',
      STELLAR_MAX_FEE: '500',
      STELLAR_FEE_PERCENTILE: 'p70',
      STELLAR_HORIZON_URL: 'https://horizon.example/',
    }) as any;
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ fee_charged: { p70: '800' } }),
    }) as any;

    await expect(service.getRecommendedFee()).resolves.toBe(500);
    await expect(service.getRecommendedFee()).resolves.toBe(500);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledWith('https://horizon.example/fee_stats');
  });

  it('falls back to the static fee when Horizon fee_stats is unavailable', async () => {
    const service = createService({ STELLAR_BASE_FEE: '125' }) as any;
    global.fetch = jest.fn().mockRejectedValue(new Error('offline')) as any;

    await expect(service.getRecommendedFee()).resolves.toBe(125);
  });

  it('checks the destination trustline against both asset code and issuer', async () => {
    const service = createService() as any;
    service.horizonClientService.getHealthyServer = jest.fn(() => ({
      loadAccount: jest.fn().mockResolvedValue({
        balances: [
          { asset_code: 'USDC', asset_issuer: 'G_ISSUER', balance: '10' },
          { asset_code: 'USDC', asset_issuer: 'G_OTHER_ISSUER', balance: '20' },
        ],
      }),
    }));

    await expect(service.destinationHasTrustline('G_DESTINATION', {
      code: 'USDC',
      issuer: 'G_ISSUER',
      isNative: () => false,
    })).resolves.toBe(true);
    await expect(service.destinationHasTrustline('G_DESTINATION', {
      code: 'USDC',
      issuer: 'G_MISSING_ISSUER',
      isNative: () => false,
    })).resolves.toBe(false);
  });

  it('alerts at most once per hour per asset and marks the distribution account degraded', async () => {
    const service = createService(
      {
        STELLAR_LOW_BALANCE_THRESHOLDS: 'XLM:100',
        STELLAR_OPS_EMAILS: '',
      },
      [{ asset_type: 'native', balance: '5' }],
    ) as any;

    await service.monitorDistributionBalances();
    await service.monitorDistributionBalances();

    expect(service.getLowBalanceHealth()).toMatchObject({
      status: 'degraded',
      lowAssets: ['XLM'],
    });
    expect(service.lastLowBalanceAlerts.size).toBe(1);
    expect(service.lastLowBalanceAlerts.has('XLM')).toBe(true);
  });
});
import { Injectable, Logger, InternalServerErrorException, BadRequestException, NotFoundException, Inject, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as StellarSdk from '@stellar/stellar-sdk';
import { MultiSigTransaction, MultiSigTransactionStatus } from './entities/multi-sig-transaction.entity';
import { StellarAsset } from './entities/stellar-asset.entity';
import { SignTransactionDto } from './dto/sign-transaction.dto';
import { AddTrustlineDto } from './dto/add-trustline.dto';
import { RemoveTrustlineDto } from './dto/remove-trustline.dto';
import { WebhooksService } from '../webhooks/webhooks.service';
import { StellarHorizonClientService } from './stellar-horizon-client.service';
import { Cron } from '@nestjs/schedule';
import { MailService } from '../auth/mail/mail.service';

export interface StellarLowBalanceThreshold {
  assetCode: string;
  threshold: number;
}

export function parseLowBalanceThresholds(value?: string): StellarLowBalanceThreshold[] {
  if (!value?.trim()) return [];
  const thresholds = new Map<string, number>();
  for (const entry of value.split(',')) {
    const [rawAssetCode, rawThreshold, ...extra] = entry.split(':');
    const assetCode = rawAssetCode?.trim().toUpperCase();
    const threshold = Number(rawThreshold?.trim());
    if (
      extra.length > 0 ||
      !assetCode ||
      !/^[A-Z0-9]{1,12}$/.test(assetCode) ||
      !Number.isFinite(threshold) ||
      threshold < 0
    ) {
      continue;
    }
    thresholds.set(assetCode, threshold);
  }
  return [...thresholds.entries()].map(([assetCode, threshold]) => ({ assetCode, threshold }));
}

@Injectable()
export class StellarService {
  private readonly logger = new Logger(StellarService.name);
  private readonly networkPassphrase: string;
  private readonly sourceKeypair: StellarSdk.Keypair;
  private feeStatsCache: { fee: number; expiresAt: number } | null = null;
  private readonly lastLowBalanceAlerts = new Map<string, number>();
  private lowBalanceHealth: {
    status: 'unknown' | 'healthy' | 'degraded';
    message: string;
    lowAssets: string[];
    checkedAt: string | null;
  } = {
    status: 'unknown',
    message: 'Distribution account balance has not been checked yet',
    lowAssets: [],
    checkedAt: null,
  };

  constructor(
    private configService: ConfigService,
    @InjectRepository(MultiSigTransaction)
    private readonly multiSigRepo: Repository<MultiSigTransaction>,
    @InjectRepository(StellarAsset)
    private readonly assetRepo: Repository<StellarAsset>,
    @Inject(forwardRef(() => WebhooksService))
    private readonly webhooksService: WebhooksService,
    private readonly horizonClientService: StellarHorizonClientService,
    private readonly mailService: MailService,
  ) {
    const secret = this.configService.get<string>('STELLAR_SOURCE_SECRET');
    const network = this.configService.get<string>('STELLAR_NETWORK');

    if (!secret) {
      throw new Error('Stellar configuration is missing. Check STELLAR_SOURCE_SECRET in .env');
    }

    this.networkPassphrase = network === 'PUBLIC'
      ? StellarSdk.Networks.PUBLIC
      : StellarSdk.Networks.TESTNET;

    this.sourceKeypair = StellarSdk.Keypair.fromSecret(secret);
  }

  async sendPayment(
    destination: string,
    amount: string,
    memo?: string,
    merchantId?: string,
    asset: StellarSdk.Asset = StellarSdk.Asset.native(),
  ) {
    return this.submitPaymentWithRetry(destination, amount, memo, merchantId, asset, 0);
  }

  private async submitPaymentWithRetry(
    destination: string,
    amount: string,
    memo: string | undefined,
    merchantId: string | undefined,
    asset: StellarSdk.Asset,
    attemptNumber: number,
  ): Promise<any> {
    try {
      const sourceAccount = await this.getServer().loadAccount(this.sourceKeypair.publicKey());
      const baseFee = this.getBaseFee();
      const maxFee = this.getMaxFee(baseFee);
      const fee = String(Math.min(maxFee, (await this.getRecommendedFee()) * (attemptNumber + 1)));
      this.logger.log(`Submitting Stellar transaction with fee ${fee} stroops`);

      const claimable = !asset.isNative() && !(await this.destinationHasTrustline(destination, asset));
      const operation = claimable
        ? StellarSdk.Operation.createClaimableBalance({
            asset,
            amount,
            claimants: this.getClaimableBalanceClaimants(destination),
          })
        : StellarSdk.Operation.payment({ destination, asset, amount });

      let transactionBuilder = new StellarSdk.TransactionBuilder(sourceAccount, {
        fee,
        networkPassphrase: this.networkPassphrase,
      })
        .addOperation(operation)
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

      const response = await this.getServer().submitTransaction(transaction);

      this.logger.log(`Payment successful: ${response.hash}`);
      let claimableBalanceId: string | null = null;
      if (claimable) {
        const operations = await this.getServer()
          .operations()
          .forTransaction(response.hash)
          .call();
        const createBalance = operations.records.find(
          (record: any) => record.type === 'create_claimable_balance',
        ) as any;
        claimableBalanceId = createBalance?.balance_id ?? null;
        if (!claimableBalanceId) {
          this.logger.error(`Claimable balance ID was not returned for transaction ${response.hash}`);
        }
      }
      return {
        ...(claimable ? { status: 'claimable', claimableBalanceId } : {}),
        hash: response.hash,
        ledger: response.ledger,
      };

    } catch (error: any) {
      const resultCodes = error.response?.data?.extras?.result_codes;
      const isInsufficientFee = resultCodes?.transaction === 'tx_insufficient_fee';
      const canRetry = attemptNumber < 3;

      if ((isInsufficientFee || this.isTimeoutError(error)) && canRetry) {
        this.logger.warn(
          { attemptNumber: attemptNumber + 1, destination, error: error.message },
          'Transaction failed with insufficient fee or timeout, retrying with higher fee',
        );
        return this.submitPaymentWithRetry(
          destination,
          amount,
          memo,
          merchantId,
          asset,
          attemptNumber + 1,
        );
      }

      this.handleStellarError(error);
    }
  }

  private async destinationHasTrustline(
    destination: string,
    asset: StellarSdk.Asset,
  ): Promise<boolean> {
    const accountId = StellarSdk.StrKey.isValidMuxedAccount(destination)
      ? StellarSdk.MuxedAccount.fromAddress(destination, '0').accountId()
      : destination;
    try {
      const account = await this.getServer().loadAccount(accountId);
      return account.balances.some(
        (balance: any) =>
          balance.asset_code === asset.code &&
          balance.asset_issuer === asset.issuer,
      );
    } catch (error: any) {
      if (error?.status === 404 || error?.response?.status === 404) return false;
      throw error;
    }
  }

  private getClaimableBalanceClaimants(destination: string): StellarSdk.Claimant[] {
    const reclaimDays = Math.max(
      1,
      Number(this.configService.get<string>('STELLAR_CLAIMABLE_RECLAIM_DAYS', '90')) || 90,
    );
    const reclaimAt = Math.floor(Date.now() / 1000) + reclaimDays * 24 * 60 * 60;
    return [
      new StellarSdk.Claimant(destination, StellarSdk.Claimant.predicateUnconditional()),
      new StellarSdk.Claimant(
        this.sourceKeypair.publicKey(),
        StellarSdk.Claimant.predicateNot(
          StellarSdk.Claimant.predicateBeforeAbsoluteTime(String(reclaimAt)),
        ),
      ),
    ];
  }

  private getServer(): StellarSdk.Horizon.Server {
    return this.horizonClientService.getHealthyServer();
  }

  getLowBalanceHealth() {
    return { ...this.lowBalanceHealth, lowAssets: [...this.lowBalanceHealth.lowAssets] };
  }

  @Cron('*/10 * * * *')
  async monitorDistributionBalances(): Promise<void> {
    const thresholds = parseLowBalanceThresholds(
      this.configService.get<string>('STELLAR_LOW_BALANCE_THRESHOLDS', ''),
    );
    if (thresholds.length === 0) {
      this.lowBalanceHealth = {
        status: 'healthy',
        message: 'Low-balance monitoring is not configured',
        lowAssets: [],
        checkedAt: new Date().toISOString(),
      };
      return;
    }

    try {
      const account = await this.getServer().loadAccount(this.sourceKeypair.publicKey());
      const results = thresholds.map(({ assetCode, threshold }) => {
        const balanceRecord = assetCode === 'XLM'
          ? account.balances.find((balance: any) => balance.asset_type === 'native')
          : account.balances.find((balance: any) => balance.asset_code === assetCode);
        const balance = balanceRecord ? Number(balanceRecord.balance) : 0;
        return { assetCode, threshold, balance: Number.isFinite(balance) ? balance : 0 };
      });
      const lowBalances = results.filter(({ balance, threshold }) => balance < threshold);
      this.lowBalanceHealth = {
        status: lowBalances.length > 0 ? 'degraded' : 'healthy',
        message: lowBalances.length > 0
          ? `Below threshold: ${lowBalances.map(({ assetCode }) => assetCode).join(', ')}`
          : 'All configured distribution-account balances are above threshold',
        lowAssets: lowBalances.map(({ assetCode }) => assetCode),
        checkedAt: new Date().toISOString(),
      };

      for (const lowBalance of lowBalances) {
        await this.sendLowBalanceAlertIfDue(lowBalance);
      }
    } catch (error) {
      this.logger.error(
        `Failed to check Stellar distribution-account balances: ${error instanceof Error ? error.message : String(error)}`,
      );
      this.lowBalanceHealth = {
        status: 'unknown',
        message: 'Unable to check Stellar distribution-account balances',
        lowAssets: [],
        checkedAt: new Date().toISOString(),
      };
    }
  }

  private async sendLowBalanceAlertIfDue(alert: {
    assetCode: string;
    threshold: number;
    balance: number;
  }): Promise<void> {
    const now = Date.now();
    const previousAlertAt = this.lastLowBalanceAlerts.get(alert.assetCode) ?? 0;
    if (now - previousAlertAt < 60 * 60 * 1000) return;
    this.lastLowBalanceAlerts.set(alert.assetCode, now);

    const accountAddress = this.sourceKeypair.publicKey();
    const payload = {
      event: 'stellar.distribution_balance_low',
      timestamp: new Date(now).toISOString(),
      account: accountAddress,
      assetCode: alert.assetCode,
      balance: String(alert.balance),
      threshold: alert.threshold,
    };
    const recipients = (this.configService.get<string>('STELLAR_OPS_EMAILS', '') || '')
      .split(',')
      .map((email) => email.trim())
      .filter(Boolean);
    await Promise.all(recipients.map((email) =>
      this.mailService.sendLowStellarBalanceAlert(
        email,
        alert.assetCode,
        String(alert.balance),
        alert.threshold,
        accountAddress,
      ).catch((error) => this.logger.error(`Failed to email low-balance alert to ${email}: ${error instanceof Error ? error.message : String(error)}`)),
    ));

    const webhookUrl = this.configService.get<string>('STELLAR_LOW_BALANCE_WEBHOOK_URL');
    if (webhookUrl) {
      try {
        const response = await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!response.ok) throw new Error(`Webhook returned ${response.status}`);
      } catch (error) {
        this.logger.error(`Failed to send low-balance webhook: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  private getBaseFee(): number {
    const configured = Number(this.configService.get<string>('STELLAR_BASE_FEE', '100'));
    return Number.isFinite(configured) && configured > 0 ? Math.floor(configured) : 100;
  }

  private getMaxFee(baseFee = this.getBaseFee()): number {
    const configured = Number(this.configService.get<string>('STELLAR_MAX_FEE', '1000'));
    return Math.max(baseFee, Number.isFinite(configured) && configured > 0 ? Math.floor(configured) : 1000);
  }

  private async getRecommendedFee(): Promise<number> {
    const now = Date.now();
    if (this.feeStatsCache && this.feeStatsCache.expiresAt > now) {
      return this.feeStatsCache.fee;
    }

    const baseFee = this.getBaseFee();
    const maxFee = this.getMaxFee(baseFee);
    const configuredPercentile = this.configService.get<string>('STELLAR_FEE_PERCENTILE', 'p70');
    const percentile = /^p(?:10|20|30|40|50|60|70|80|90|95|99)$/.test(configuredPercentile)
      ? configuredPercentile
      : 'p70';
    let selectedFee = baseFee;
    const horizonUrl = this.configService.get<string>(
      'STELLAR_HORIZON_URL',
      'https://horizon-testnet.stellar.org',
    ).replace(/\/$/, '');

    try {
      const response = await fetch(`${horizonUrl}/fee_stats`);
      if (!response.ok) throw new Error(`Horizon fee_stats returned ${response.status}`);
      const stats = await response.json() as { fee_charged?: Record<string, unknown> };
      const observedFee = Number(stats.fee_charged?.[percentile]);
      if (!Number.isFinite(observedFee) || observedFee <= 0) {
        throw new Error(`Horizon fee_stats did not contain a valid ${percentile} fee`);
      }
      selectedFee = Math.min(maxFee, Math.max(baseFee, Math.ceil(observedFee)));
    } catch (error) {
      this.logger.warn(`Unable to retrieve Horizon fee_stats; using static fee ${baseFee}: ${error instanceof Error ? error.message : String(error)}`);
    }

    this.feeStatsCache = { fee: selectedFee, expiresAt: now + 30_000 };
    return selectedFee;
  }

  private isTimeoutError(error: any): boolean {
    const message = error.message?.toLowerCase() || '';
    return message.includes('timeout') || message.includes('deadline exceeded');
  }

  async submitFeeBumpTransaction(innerTransactionXdr: string, feeBump: number): Promise<any> {
    const maxFee = this.configService.get<number>('STELLAR_MAX_FEE', 1000);
    if (feeBump > maxFee) {
      throw new BadRequestException(`Fee bump exceeds maximum fee of ${maxFee} stroops`);
    }

    try {
      const innerTx = new StellarSdk.Transaction(innerTransactionXdr, this.networkPassphrase);
      const feeBumpTx = StellarSdk.TransactionBuilder.buildFeeBumpTransaction(
        this.sourceKeypair,
        feeBump.toString(),
        innerTx,
        this.networkPassphrase,
      );

      feeBumpTx.sign(this.sourceKeypair);
      const response = await this.getServer().submitTransaction(feeBumpTx);

      this.logger.log(`Fee-bump transaction submitted: ${response.hash}`);
      return {
        hash: response.hash,
        ledger: response.ledger,
      };
    } catch (error) {
      this.logger.error('Failed to submit fee-bump transaction', error);
      this.handleStellarError(error);
    }
  }

  async validatePayoutDestination(address: string, assetCode: string): Promise<void> {
    if (!StellarSdk.StrKey.isValidEd25519PublicKey(address)) {
      throw new BadRequestException('Invalid Stellar payout address');
    }

    let account: StellarSdk.Horizon.AccountResponse;
    try {
      account = await this.getServer().loadAccount(address);
    } catch {
      throw new BadRequestException('Stellar payout account does not exist');
    }

    if (assetCode.toUpperCase() === 'XLM') return;

    const hasTrustline = account.balances.some(
      (balance: any) => balance.asset_code === assetCode,
    );
    if (!hasTrustline) {
      throw new BadRequestException(
        `Stellar payout account has no trustline for ${assetCode}`,
      );
    }
  }

  /**
   * Validates a third-party payout recipient: the account must exist, hold a
   * trustline for non-native assets and, when it sets the SEP-29
   * `config.memo_required` data entry, the payout must carry a memo.
   */
  async validatePayoutRecipient(
    address: string,
    assetCode: string,
    memo?: string | null,
  ): Promise<void> {
    if (!StellarSdk.StrKey.isValidEd25519PublicKey(address)) {
      throw new BadRequestException('Invalid Stellar destination address');
    }

    let account: StellarSdk.Horizon.AccountResponse;
    try {
      account = await this.getServer().loadAccount(address);
    } catch {
      throw new BadRequestException('Destination Stellar account does not exist');
    }

    if (assetCode.toUpperCase() !== 'XLM') {
      const hasTrustline = account.balances.some(
        (balance: any) => balance.asset_code === assetCode.toUpperCase(),
      );
      if (!hasTrustline) {
        throw new BadRequestException(
          `Destination Stellar account has no trustline for ${assetCode}`,
        );
      }
    }

    const memoRequired = (account as any).data_attr?.['config.memo_required'];
    if (memoRequired && !memo) {
      throw new BadRequestException('Destination account requires a memo');
    }
  }

  /**
   * Sends a payout from the platform account. Non-native assets are sent with
   * the issuer of the matching balance held by the platform account.
   */
  async sendPayout(params: {
    destination: string;
    amount: string;
    assetCode: string;
    memo?: string | null;
    merchantId?: string;
  }) {
    const assetCode = params.assetCode.toUpperCase();
    let asset = StellarSdk.Asset.native();

    if (assetCode !== 'XLM') {
      const source = await this.getServer().loadAccount(this.sourceKeypair.publicKey());
      const balance = source.balances.find(
        (b: any) => b.asset_code === assetCode && b.asset_issuer,
      ) as { asset_issuer: string } | undefined;
      if (!balance) {
        throw new BadRequestException(
          `Platform account does not hold ${assetCode}`,
        );
      }
      asset = new StellarSdk.Asset(assetCode, balance.asset_issuer);
    }

    return this.sendPayment(
      params.destination,
      params.amount,
      params.memo ?? undefined,
      params.merchantId,
      asset,
    );
  }

  async listTransactions(status?: MultiSigTransactionStatus): Promise<MultiSigTransaction[]> {
    return this.multiSigRepo.find({
      where: status ? { status } : {},
      order: { createdAt: 'DESC' },
    });
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

      const sourceAccount = await this.getServer().loadAccount(multiSigTx.sourceAccount);
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
        const response = await this.getServer().submitTransaction(transaction);
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

  async listAssets(merchantId: string): Promise<StellarAsset[]> {
    return this.assetRepo.find({
      where: { merchantId },
      order: { createdAt: 'DESC' },
    });
  }

  getMode(): 'test' | 'live' {
    return this.configService.get<string>('STELLAR_NETWORK') === 'PUBLIC' ? 'live' : 'test';
  }

  async fundTestnetAccount(address: string): Promise<any> {
    if (this.getMode() !== 'test') {
      throw new BadRequestException('Friendbot funding is only available in testnet mode');
    }

    try {
      const response = await fetch(`https://friendbot.stellar.org?addr=${address}`);
      const data = await response.json();
      return data;
    } catch (error) {
      this.logger.error('Failed to fund testnet account', error);
      throw new InternalServerErrorException('Failed to fund testnet account');
    }
  }

  async addTrustline(dto: AddTrustlineDto, merchantId: string): Promise<StellarAsset> {
    const existing = await this.assetRepo.findOne({
      where: { merchantId, assetCode: dto.assetCode, assetIssuer: dto.assetIssuer },
    });

    if (existing) {
      existing.isAccepted = true;
      existing.trustlineAddedAt = new Date();
      return this.assetRepo.save(existing);
    }

    const asset = this.assetRepo.create({
      merchantId,
      assetCode: dto.assetCode,
      assetIssuer: dto.assetIssuer,
      isAccepted: true,
      trustlineAddedAt: new Date(),
    });

    return this.assetRepo.save(asset);
  }

  async removeTrustline(dto: RemoveTrustlineDto, merchantId: string): Promise<void> {
    const asset = await this.assetRepo.findOne({
      where: { merchantId, assetCode: dto.assetCode, assetIssuer: dto.assetIssuer },
    });

    if (!asset) {
      throw new NotFoundException('Asset not found');
    }

    asset.isAccepted = false;
    asset.trustlineAddedAt = null;
    await this.assetRepo.save(asset);
  }

  async getBalances(merchantId: string): Promise<any> {
    const assets = await this.assetRepo.find({
      where: { merchantId, isAccepted: true },
    });

    if (assets.length === 0) {
      return [];
    }

    let account: StellarSdk.Horizon.AccountResponse | undefined;
    try {
      account = await this.getServer().loadAccount(this.sourceKeypair.publicKey());
    } catch (error) {
      this.logger.error('Failed to load Stellar account for balances', error);
    }

    return assets.map((asset) => {
      if (!account) {
        return {
          assetCode: asset.assetCode,
          assetIssuer: asset.assetIssuer,
          balance: '0',
          error: 'Failed to fetch balance',
        };
      }

      const balance = account.balances.find(
        (b: any) => b.asset_code === asset.assetCode && b.asset_issuer === asset.assetIssuer,
      );

      return {
        assetCode: asset.assetCode,
        assetIssuer: asset.assetIssuer,
        balance: balance ? balance.balance : '0',
      };
    });
  }

  async validateAddress(address: string, assetCode?: string): Promise<{
    valid: boolean;
    format: 'g' | 'm' | null;
    exists: boolean;
    hasTrustline: boolean;
    requiresMemo: boolean;
    error?: string;
  }> {
    // Check address format
    const isValidEd25519 = StellarSdk.StrKey.isValidEd25519PublicKey(address);
    const isValidMuxed = StellarSdk.StrKey.isValidMuxedAccount(address);

    if (!isValidEd25519 && !isValidMuxed) {
      return {
        valid: false,
        format: null,
        exists: false,
        hasTrustline: false,
        requiresMemo: false,
        error: 'Invalid Stellar address format',
      };
    }

    const format = isValidMuxed ? 'm' : 'g';

    // Check if account exists on network
    let account: StellarSdk.Horizon.AccountResponse | null = null;
    const accountAddress = isValidMuxed
      ? StellarSdk.MuxedAccount.fromAddress(address, '0').accountId()
      : address;

    try {
      account = await this.getServer().loadAccount(accountAddress);
    } catch (error: any) {
      if (error.status === 404) {
        return {
          valid: false,
          format,
          exists: false,
          hasTrustline: false,
          requiresMemo: false,
          error: 'Account does not exist on network',
        };
      }
      throw error;
    }

    // Check trustline if asset is specified
    let hasTrustline = true;
    if (assetCode && assetCode.toUpperCase() !== 'XLM') {
      hasTrustline = account.balances.some(
        (b: any) => b.asset_code === assetCode.toUpperCase(),
      );
    }

    // Check SEP-29 memo requirement
    let requiresMemo = false;
    try {
      const response = await fetch(`${this.configService.get<string>('STELLAR_HORIZON_URL')}/accounts/${accountAddress}`);
      const data = await response.json();
      const config = data.data_attr?.config;
      if (config) {
        requiresMemo = config.includes('memo_required');
      }
    } catch {
      // Ignore SEP-29 check failure
    }

    return {
      valid: true,
      format,
      exists: true,
      hasTrustline,
      requiresMemo,
    };
  }
}
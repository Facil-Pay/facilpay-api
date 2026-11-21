/**
 * SEP-24 Interactive Anchor Service
 *
 * Implements server-side SEP-24 (Interactive Anchored Asset Transfer) on top of:
 *   - SEP-1  (stellar.toml discovery)
 *   - SEP-10 (challenge/response auth with the anchor)
 *   - SEP-24 /transactions/withdraw/interactive
 *   - SEP-24 /transaction polling
 *
 * The service uses Node's built-in fetch (Node 18+); no extra HTTP dep needed.
 */
import {
  Injectable,
  BadRequestException,
  NotFoundException,
  InternalServerErrorException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import * as StellarSdk from '@stellar/stellar-sdk';
import { AnchorConfig } from './entities/anchor-config.entity';
import { AnchorWithdrawal, AnchorWithdrawalStatus } from './entities/anchor-withdrawal.entity';
import { CreateAnchorConfigDto } from './dto/create-anchor-config.dto';
import { StartWithdrawalDto } from './dto/start-withdrawal.dto';
import { ListWithdrawalsDto } from './dto/list-withdrawals.dto';
import { WebhooksService } from '../webhooks/webhooks.service';
import { EventsService } from '../events/events.service';
import { StellarService } from '../stellar/stellar.service';
import { AppLogger } from '../logger/logger.service';
import { Logger } from 'pino';

/** Statuses that require polling the anchor for an update. */
const POLLING_STATUSES = new Set([
  AnchorWithdrawalStatus.PENDING_USER,
  AnchorWithdrawalStatus.PENDING_ANCHOR,
  AnchorWithdrawalStatus.PENDING_STELLAR,
]);

/** Map from anchor-reported status strings → our internal enum values. */
const ANCHOR_STATUS_MAP: Record<string, AnchorWithdrawalStatus> = {
  incomplete:       AnchorWithdrawalStatus.PENDING_USER,
  pending_user_transfer_start: AnchorWithdrawalStatus.PENDING_STELLAR,
  pending_anchor:   AnchorWithdrawalStatus.PENDING_ANCHOR,
  pending_stellar:  AnchorWithdrawalStatus.PENDING_ANCHOR,
  pending_external: AnchorWithdrawalStatus.PENDING_ANCHOR,
  completed:        AnchorWithdrawalStatus.COMPLETED,
  refunded:         AnchorWithdrawalStatus.FAILED,
  expired:          AnchorWithdrawalStatus.FAILED,
  error:            AnchorWithdrawalStatus.FAILED,
  no_market:        AnchorWithdrawalStatus.FAILED,
};

@Injectable()
export class Sep24Service {
  private readonly logger: Logger;
  private readonly networkPassphrase: string;
  private readonly sourceKeypair: StellarSdk.Keypair;

  constructor(
    @InjectRepository(AnchorConfig)
    private readonly anchorConfigRepo: Repository<AnchorConfig>,
    @InjectRepository(AnchorWithdrawal)
    private readonly withdrawalRepo: Repository<AnchorWithdrawal>,
    private readonly dataSource: DataSource,
    private readonly configService: ConfigService,
    private readonly stellarService: StellarService,
    private readonly webhooksService: WebhooksService,
    private readonly eventsService: EventsService,
    appLogger: AppLogger,
  ) {
    this.logger = appLogger.child({ module: Sep24Service.name });

    const secret = this.configService.get<string>('STELLAR_SOURCE_SECRET');
    if (!secret) {
      throw new Error('STELLAR_SOURCE_SECRET is required for SEP-24 auth');
    }
    this.sourceKeypair = StellarSdk.Keypair.fromSecret(secret);

    const network = this.configService.get<string>('STELLAR_NETWORK');
    this.networkPassphrase =
      network === 'PUBLIC' ? StellarSdk.Networks.PUBLIC : StellarSdk.Networks.TESTNET;
  }

  // ── Anchor config management ───────────────────────────────────────────────

  async createAnchorConfig(merchantId: string, dto: CreateAnchorConfigDto): Promise<AnchorConfig> {
    const existing = await this.anchorConfigRepo.findOne({
      where: { merchantId, homeDomain: dto.homeDomain },
    });
    if (existing) {
      throw new ConflictException(
        `Anchor config for home domain '${dto.homeDomain}' already exists`,
      );
    }

    const config = this.anchorConfigRepo.create({
      merchantId,
      homeDomain: dto.homeDomain,
      supportedAssets: dto.supportedAssets.map((a) => a.toUpperCase()),
      isActive: dto.isActive ?? true,
    });
    return this.anchorConfigRepo.save(config);
  }

  async listAnchorConfigs(merchantId: string): Promise<AnchorConfig[]> {
    return this.anchorConfigRepo.find({
      where: { merchantId },
      order: { createdAt: 'DESC' },
    });
  }

  async deleteAnchorConfig(merchantId: string, id: string): Promise<void> {
    const config = await this.anchorConfigRepo.findOne({ where: { id, merchantId } });
    if (!config) throw new NotFoundException(`Anchor config ${id} not found`);
    await this.anchorConfigRepo.remove(config);
  }

  // ── SEP-24 withdrawal initiation ───────────────────────────────────────────

  async startWithdrawal(merchantId: string, dto: StartWithdrawalDto): Promise<AnchorWithdrawal> {
    const anchorConfig = await this.anchorConfigRepo.findOne({
      where: { id: dto.anchorConfigId, merchantId, isActive: true },
    });
    if (!anchorConfig) {
      throw new NotFoundException(
        `Anchor config ${dto.anchorConfigId} not found or inactive`,
      );
    }

    const assetCode = dto.assetCode.toUpperCase();
    if (!anchorConfig.supportedAssets.includes(assetCode)) {
      throw new BadRequestException(
        `Asset ${assetCode} is not supported by anchor ${anchorConfig.homeDomain}`,
      );
    }

    // Discover anchor endpoints via SEP-1 stellar.toml
    const toml = await this.fetchStellarToml(anchorConfig.homeDomain);
    const transferServerUrl = toml['TRANSFER_SERVER_SEP0024'] ?? toml['TRANSFER_SERVER'];
    const webAuthEndpoint = toml['WEB_AUTH_ENDPOINT'];

    if (!transferServerUrl) {
      throw new InternalServerErrorException(
        `Anchor ${anchorConfig.homeDomain} does not advertise a TRANSFER_SERVER_SEP0024`,
      );
    }
    if (!webAuthEndpoint) {
      throw new InternalServerErrorException(
        `Anchor ${anchorConfig.homeDomain} does not advertise a WEB_AUTH_ENDPOINT`,
      );
    }

    // SEP-10: authenticate with the anchor
    const sep10Token = await this.authenticateSep10(webAuthEndpoint, anchorConfig.homeDomain);

    // SEP-24: start interactive withdrawal
    const interactiveResult = await this.initiateInteractiveWithdrawal(
      transferServerUrl,
      sep10Token,
      assetCode,
      dto.amount,
      dto.email,
    );

    const withdrawal = this.withdrawalRepo.create({
      merchantId,
      anchorConfigId: anchorConfig.id,
      anchorTransactionId: interactiveResult.id,
      assetCode,
      amount: dto.amount,
      status: AnchorWithdrawalStatus.PENDING_USER,
      interactiveUrl: interactiveResult.url,
      withdrawAnchorAccount: null,
      withdrawMemo: null,
      withdrawMemoType: null,
      stellarTransactionHash: null,
      failureReason: null,
    });

    const saved = await this.withdrawalRepo.save(withdrawal);

    this.eventsService.emit(merchantId, 'anchor.withdrawal.started', {
      withdrawalId: saved.id,
      anchorTransactionId: saved.anchorTransactionId,
      assetCode,
      amount: dto.amount,
      interactiveUrl: saved.interactiveUrl,
    });

    this.logger.info(
      { withdrawalId: saved.id, anchorTransactionId: saved.anchorTransactionId },
      'SEP-24 withdrawal initiated',
    );

    return saved;
  }

  // ── Withdrawal queries ─────────────────────────────────────────────────────

  async listWithdrawals(
    merchantId: string,
    dto: ListWithdrawalsDto,
  ): Promise<{ data: AnchorWithdrawal[]; total: number }> {
    const qb = this.withdrawalRepo
      .createQueryBuilder('w')
      .where('w.merchantId = :merchantId', { merchantId })
      .orderBy('w.createdAt', 'DESC');

    if (dto.status) {
      qb.andWhere('w.status = :status', { status: dto.status });
    }

    const [data, total] = await qb
      .skip(dto.offset ?? 0)
      .take(dto.limit ?? 20)
      .getManyAndCount();

    return { data, total };
  }

  async findWithdrawal(merchantId: string, id: string): Promise<AnchorWithdrawal> {
    const record = await this.withdrawalRepo.findOne({ where: { id, merchantId } });
    if (!record) throw new NotFoundException(`Anchor withdrawal ${id} not found`);
    return record;
  }

  // ── Status polling ─────────────────────────────────────────────────────────

  /**
   * Polls each in-flight withdrawal at the anchor and updates local state.
   * Runs every minute. On PENDING_STELLAR, dispatches the on-chain send.
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async pollWithdrawals(): Promise<void> {
    const pending = await this.withdrawalRepo
      .createQueryBuilder('w')
      .leftJoinAndSelect('w.anchorConfig', 'ac')
      .where('w.status IN (:...statuses)', {
        statuses: [...POLLING_STATUSES],
      })
      .getMany();

    for (const withdrawal of pending) {
      try {
        await this.syncWithdrawalStatus(withdrawal);
      } catch (err) {
        this.logger.error(
          { withdrawalId: withdrawal.id, err },
          'Failed to poll withdrawal status',
        );
      }
    }
  }

  async syncWithdrawalStatus(withdrawal: AnchorWithdrawal): Promise<AnchorWithdrawal> {
    const toml = await this.fetchStellarToml(withdrawal.anchorConfig.homeDomain);
    const transferServerUrl = toml['TRANSFER_SERVER_SEP0024'] ?? toml['TRANSFER_SERVER'];
    const webAuthEndpoint = toml['WEB_AUTH_ENDPOINT'];

    if (!transferServerUrl || !webAuthEndpoint) return withdrawal;

    const sep10Token = await this.authenticateSep10(
      webAuthEndpoint,
      withdrawal.anchorConfig.homeDomain,
    );

    const anchorTx = await this.fetchAnchorTransaction(
      transferServerUrl,
      sep10Token,
      withdrawal.anchorTransactionId,
    );

    return this.applyAnchorStatus(withdrawal, anchorTx);
  }

  // ── SEP-10 implementation ──────────────────────────────────────────────────

  /**
   * Full server-side SEP-10 challenge/response flow:
   *   1. GET /auth?account=<pubkey>  → challenge XDR
   *   2. Sign the challenge transaction
   *   3. POST /auth { transaction: <signed XDR> } → JWT
   */
  async authenticateSep10(webAuthEndpoint: string, homeDomain: string): Promise<string> {
    const pubkey = this.sourceKeypair.publicKey();

    // Step 1: fetch challenge
    const challengeUrl = `${webAuthEndpoint}?account=${pubkey}`;
    const challengeRes = await fetchJson<{ transaction: string; network_passphrase: string }>(
      challengeUrl,
      { headers: { 'Accept': 'application/json' } },
    );

    if (!challengeRes.transaction) {
      throw new InternalServerErrorException(
        `SEP-10 challenge from ${homeDomain} did not contain a transaction`,
      );
    }

    // Step 2: validate and sign
    const networkPassphrase = challengeRes.network_passphrase ?? this.networkPassphrase;
    const challengeTx = new StellarSdk.Transaction(challengeRes.transaction, networkPassphrase);
    challengeTx.sign(this.sourceKeypair);
    const signedXdr = challengeTx.toXDR();

    // Step 3: exchange for JWT
    const tokenRes = await fetchJson<{ token: string }>(webAuthEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ transaction: signedXdr }),
    });

    if (!tokenRes.token) {
      throw new InternalServerErrorException(
        `SEP-10 token exchange with ${homeDomain} returned no token`,
      );
    }

    return tokenRes.token;
  }

  // ── SEP-1 toml parsing ─────────────────────────────────────────────────────

  async fetchStellarToml(homeDomain: string): Promise<Record<string, string>> {
    const url = `https://${homeDomain}/.well-known/stellar.toml`;
    let raw: string;

    try {
      const res = await fetch(url, { headers: { Accept: 'text/plain, text/*, */*' } });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      raw = await res.text();
    } catch (err) {
      throw new InternalServerErrorException(
        `Could not fetch stellar.toml from ${homeDomain}: ${(err as Error).message}`,
      );
    }

    return parseStellarToml(raw);
  }

  // ── SEP-24 HTTP calls ──────────────────────────────────────────────────────

  private async initiateInteractiveWithdrawal(
    transferServerUrl: string,
    sep10Token: string,
    assetCode: string,
    amount: string,
    email?: string,
  ): Promise<{ id: string; url: string }> {
    const body = new URLSearchParams({
      asset_code: assetCode,
      amount,
      ...(email ? { email_address: email } : {}),
    });

    const res = await fetchJson<{ type: string; url: string; id: string }>(
      `${transferServerUrl}/transactions/withdraw/interactive`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${sep10Token}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: body.toString(),
      },
    );

    if (res.type !== 'interactive_customer_info_needed' || !res.url || !res.id) {
      throw new InternalServerErrorException(
        'Anchor did not return an interactive URL for the withdrawal',
      );
    }

    return { id: res.id, url: res.url };
  }

  private async fetchAnchorTransaction(
    transferServerUrl: string,
    sep10Token: string,
    anchorTransactionId: string,
  ): Promise<Record<string, any>> {
    const res = await fetchJson<{ transaction: Record<string, any> }>(
      `${transferServerUrl}/transaction?id=${anchorTransactionId}`,
      {
        headers: {
          Authorization: `Bearer ${sep10Token}`,
          Accept: 'application/json',
        },
      },
    );
    return res.transaction ?? {};
  }

  // ── Status reconciliation ──────────────────────────────────────────────────

  private async applyAnchorStatus(
    withdrawal: AnchorWithdrawal,
    anchorTx: Record<string, any>,
  ): Promise<AnchorWithdrawal> {
    const anchorStatus: string = anchorTx.status ?? '';
    const newStatus = ANCHOR_STATUS_MAP[anchorStatus] ?? withdrawal.status;
    const previousStatus = withdrawal.status;

    // Absorb routing info when the anchor tells us where to send the funds
    if (anchorTx.withdraw_anchor_account) {
      withdrawal.withdrawAnchorAccount = anchorTx.withdraw_anchor_account;
    }
    if (anchorTx.withdraw_memo) {
      withdrawal.withdrawMemo = anchorTx.withdraw_memo;
      withdrawal.withdrawMemoType = anchorTx.withdraw_memo_type ?? 'text';
    }

    if (anchorTx.stellar_transaction_id) {
      withdrawal.stellarTransactionHash = anchorTx.stellar_transaction_id;
    }

    if (newStatus === AnchorWithdrawalStatus.FAILED && !withdrawal.failureReason) {
      withdrawal.failureReason = anchorTx.message ?? anchorStatus;
    }

    if (newStatus === previousStatus) {
      // Check if routing details changed even without a status change
      const routingChanged =
        withdrawal.withdrawAnchorAccount !== null || withdrawal.withdrawMemo !== null;
      if (!routingChanged) return withdrawal;
    }

    withdrawal.status = newStatus;
    const updated = await this.withdrawalRepo.save(withdrawal);

    if (newStatus !== previousStatus) {
      this.logger.info(
        {
          withdrawalId: withdrawal.id,
          previousStatus,
          newStatus,
          anchorStatus,
        },
        'Anchor withdrawal status changed',
      );

      await this.webhooksService
        .dispatchEventToMerchant(withdrawal.merchantId, 'anchor.withdrawal.status_changed', {
          withdrawalId: withdrawal.id,
          anchorTransactionId: withdrawal.anchorTransactionId,
          previousStatus,
          status: newStatus,
          assetCode: withdrawal.assetCode,
          amount: withdrawal.amount,
        })
        .catch((err) =>
          this.logger.error({ err, withdrawalId: withdrawal.id }, 'Failed to dispatch webhook'),
        );

      this.eventsService.emit(withdrawal.merchantId, 'anchor.withdrawal.status_changed', {
        withdrawalId: withdrawal.id,
        status: newStatus,
        previousStatus,
      });

      // When the anchor is ready to receive the Stellar send, dispatch it
      if (newStatus === AnchorWithdrawalStatus.PENDING_STELLAR) {
        await this.dispatchStellarSend(updated).catch((err) =>
          this.logger.error({ err, withdrawalId: withdrawal.id }, 'Failed to dispatch Stellar send'),
        );
      }
    }

    return updated;
  }

  /**
   * Sends the requested asset to the anchor's withdrawal account.
   * Updates the withdrawal with the Stellar transaction hash.
   */
  private async dispatchStellarSend(withdrawal: AnchorWithdrawal): Promise<void> {
    if (!withdrawal.withdrawAnchorAccount) {
      this.logger.warn(
        { withdrawalId: withdrawal.id },
        'PENDING_STELLAR but no withdrawAnchorAccount — skipping send',
      );
      return;
    }

    try {
      const result = await this.stellarService.sendPayout({
        destination: withdrawal.withdrawAnchorAccount,
        amount: withdrawal.amount,
        assetCode: withdrawal.assetCode,
        memo: withdrawal.withdrawMemo,
        merchantId: withdrawal.merchantId,
      });

      if (result?.hash) {
        withdrawal.stellarTransactionHash = result.hash;
        await this.withdrawalRepo.save(withdrawal);

        this.logger.info(
          { withdrawalId: withdrawal.id, hash: result.hash },
          'Stellar send dispatched for anchor withdrawal',
        );
      }
    } catch (err) {
      withdrawal.status = AnchorWithdrawalStatus.FAILED;
      withdrawal.failureReason = `Stellar send failed: ${(err as Error).message}`;
      await this.withdrawalRepo.save(withdrawal);

      await this.webhooksService
        .dispatchEventToMerchant(withdrawal.merchantId, 'anchor.withdrawal.status_changed', {
          withdrawalId: withdrawal.id,
          status: AnchorWithdrawalStatus.FAILED,
          previousStatus: AnchorWithdrawalStatus.PENDING_STELLAR,
          failureReason: withdrawal.failureReason,
        })
        .catch(() => undefined);
    }
  }
}

// ── helpers ─────────────────────────────────────────────────────────────────

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (err) {
    throw new InternalServerErrorException(
      `Network request to ${url} failed: ${(err as Error).message}`,
    );
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new InternalServerErrorException(
      `Request to ${url} returned ${res.status}: ${body.slice(0, 200)}`,
    );
  }
  return res.json() as Promise<T>;
}

/**
 * Minimal TOML key=value parser — only handles top-level string assignments.
 * We only need TRANSFER_SERVER_SEP0024, TRANSFER_SERVER, and WEB_AUTH_ENDPOINT.
 */
export function parseStellarToml(raw: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx < 0) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
    result[key] = val;
  }
  return result;
}

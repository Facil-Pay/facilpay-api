import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { randomBytes } from 'crypto';
import * as StellarSdk from '@stellar/stellar-sdk';
import { AppLogger } from '../logger/logger.service';
import { Logger } from 'pino';
import { UsersService } from '../users/users.service';
import { AuthService } from './auth.service';

interface Sep10ChallengeRecord {
  account: string;
  homeDomain: string;
  transaction: string;
  txHashHex: string;
  expiresAt: number;
}

@Injectable()
export class Sep10Service {
  private readonly logger: Logger;
  private readonly challenges = new Map<string, Sep10ChallengeRecord>();

  constructor(
    private readonly configService: ConfigService,
    private readonly jwtService: JwtService,
    private readonly usersService: UsersService,
    private readonly authService: AuthService,
    appLogger: AppLogger,
  ) {
    this.logger = appLogger.child({ module: Sep10Service.name });
  }

  private getSep10Config() {
    const network = this.configService.get<string>('STELLAR_NETWORK', 'TESTNET');
    const networkPassphrase =
      network === 'PUBLIC' ? StellarSdk.Networks.PUBLIC : StellarSdk.Networks.TESTNET;
    const signingSecret =
      this.configService.get<string>('SEP10_SIGNING_SECRET', '') ||
      this.configService.get<string>('STELLAR_SOURCE_SECRET', '');
    const homeDomain =
      this.configService.get<string>('SEP10_HOME_DOMAIN', '') ||
      this.configService.get<string>('STELLAR_HOME_DOMAIN', 'facilpay.com');
    const timeoutSeconds = Number(
      this.configService.get<string>('SEP10_CHALLENGE_TIMEOUT_SECONDS', '900'),
    );

    if (!signingSecret) {
      throw new BadRequestException(
        'SEP-10 is not configured. Set SEP10_SIGNING_SECRET or STELLAR_SOURCE_SECRET.',
      );
    }

    let serverKeypair: StellarSdk.Keypair;
    try {
      serverKeypair = StellarSdk.Keypair.fromSecret(signingSecret);
    } catch {
      throw new BadRequestException('SEP-10 signing secret is invalid');
    }

    return {
      networkPassphrase,
      serverKeypair,
      homeDomain,
      timeoutSeconds: Number.isFinite(timeoutSeconds) && timeoutSeconds > 0 ? timeoutSeconds : 900,
    };
  }

  async buildChallenge(account: string, homeDomainOverride?: string): Promise<{
    transaction: string;
    networkPassphrase: string;
    homeDomain: string;
    expiresAt: string;
  }> {
    if (!StellarSdk.StrKey.isValidEd25519PublicKey(account)) {
      throw new BadRequestException('account must be a valid Stellar public key (G...)');
    }

    const { networkPassphrase, serverKeypair, homeDomain, timeoutSeconds } =
      this.getSep10Config();
    const effectiveHomeDomain = homeDomainOverride || homeDomain;
    const configuredHomeDomain = homeDomain;
    if (homeDomainOverride && homeDomainOverride !== configuredHomeDomain) {
      throw new BadRequestException('homeDomain does not match the server home domain');
    }

    const nonce = randomBytes(32).toString('hex');
    const value = `${effectiveHomeDomain} auth:${nonce}`;
    if (Buffer.byteLength(value, 'utf8') > 64) {
      throw new BadRequestException('Challenge value exceeds 64 bytes');
    }

    const serverAccount = new StellarSdk.Account(serverKeypair.publicKey(), '0');
    const nowSeconds = Math.floor(Date.now() / 1000);

    const tx = new StellarSdk.TransactionBuilder(serverAccount, {
      fee: StellarSdk.BASE_FEE,
      networkPassphrase,
      timebounds: {
        minTime: nowSeconds - 60,
        maxTime: nowSeconds + timeoutSeconds,
      },
    })
      .addOperation(
        StellarSdk.Operation.manageData({
          name: `${effectiveHomeDomain} auth`,
          value,
          source: account,
        }),
      )
      .addMemo(StellarSdk.Memo.text(nonce.slice(0, 28)))
      .build();

    tx.sign(serverKeypair);

    const xdr = tx.toEnvelope().toXDR('base64') as string;
    const txHashHex = Buffer.from(tx.hash()).toString('hex');
    const expiresAt = Date.now() + timeoutSeconds * 1000;

    this.pruneChallenges();
    this.challenges.set(txHashHex, {
      account,
      homeDomain: effectiveHomeDomain,
      transaction: xdr,
      txHashHex,
      expiresAt,
    });

    this.logger.debug({ account, txHashHex }, 'SEP-10 challenge issued');

    return {
      transaction: xdr,
      networkPassphrase,
      homeDomain: effectiveHomeDomain,
      expiresAt: new Date(expiresAt).toISOString(),
    };
  }

  async verifyChallengeAndLogin(
    transactionXdr: string,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<{ access_token: string; refresh_token: string; user: unknown; stellarAccount: string }> {
    const { networkPassphrase, serverKeypair, homeDomain } = this.getSep10Config();

    let tx: StellarSdk.Transaction;
    try {
      const parsed = StellarSdk.TransactionBuilder.fromXDR(transactionXdr, networkPassphrase);
      if (parsed instanceof StellarSdk.Transaction) {
        tx = parsed;
      } else {
        throw new Error('Expected a Transaction envelope');
      }

    } catch (error) {
      throw new BadRequestException(
        `Invalid challenge transaction: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    const txHashHex = Buffer.from(tx.hash()).toString('hex');
    const stored = this.challenges.get(txHashHex);
    if (!stored) {
      throw new UnauthorizedException('Unknown or already-used SEP-10 challenge (replay protected)');
    }
    if (stored.expiresAt <= Date.now()) {
      this.challenges.delete(txHashHex);
      throw new UnauthorizedException('SEP-10 challenge has expired');
    }

    const nowSeconds = Math.floor(Date.now() / 1000);
    const timeBounds = tx.timeBounds;
    if (!timeBounds || Number(timeBounds.maxTime) <= nowSeconds || Number(timeBounds.minTime) > nowSeconds) {
      this.challenges.delete(txHashHex);
      throw new UnauthorizedException('SEP-10 challenge is outside its time bounds');
    }

    if (tx.source !== serverKeypair.publicKey()) {
      throw new UnauthorizedException('SEP-10 challenge was not issued by this server');
    }

    const manageDataOp = tx.operations?.[0] as
      | { type?: string; name?: string; value?: Buffer | string; source?: string }
      | undefined;
    const opSource = (manageDataOp as unknown as { source?: string })?.source ?? tx.operations?.[0]?.source;
    const clientAccount = stored.account;

    if (!opSource || opSource !== clientAccount) {
      throw new UnauthorizedException('SEP-10 challenge operation source does not match the client account');
    }

    const expectedPrefix = `${stored.homeDomain} auth`;
    const opName = (manageDataOp as { name?: string })?.name ?? '';
    if (opName !== expectedPrefix && opName !== homeDomain + ' auth') {
      throw new UnauthorizedException('SEP-10 challenge home domain mismatch');
    }

    const sdkUtils = (StellarSdk as unknown as {
      Utils?: {
        verifyTxSignedBy?: (t: unknown, accountId: string) => boolean;
        verifyChallengeTxSigners?: (
          t: unknown,
          serverAccountId: string,
          networkPassphrase: string,
          signers: string[],
        ) => string[];
      };
    }).Utils;

    const serverSigned =
      typeof sdkUtils?.verifyTxSignedBy === 'function'
        ? sdkUtils.verifyTxSignedBy(tx, serverKeypair.publicKey())
        : this.hasSignatureFrom(tx, serverKeypair.publicKey());
    if (!serverSigned) {
      throw new UnauthorizedException('SEP-10 challenge is missing the server signature');
    }

    let clientSigned = false;
    if (typeof sdkUtils?.verifyTxSignedBy === 'function') {
      clientSigned = sdkUtils.verifyTxSignedBy(tx, clientAccount);
    } else if (typeof sdkUtils?.verifyChallengeTxSigners === 'function') {
      try {
        const signers = sdkUtils.verifyChallengeTxSigners(
          tx,
          serverKeypair.publicKey(),
          networkPassphrase,
          [clientAccount],
        );
        clientSigned = signers.includes(clientAccount);
      } catch {
        clientSigned = this.hasSignatureFrom(tx, clientAccount);
      }
    } else {
      clientSigned = this.hasSignatureFrom(tx, clientAccount);
    }
    if (!clientSigned) {
      throw new UnauthorizedException('SEP-10 challenge is missing the client signature');
    }

    this.challenges.delete(txHashHex);

    const stellarEmail = `${clientAccount.toLowerCase()}@stellar.sep10.local`;
    let user = await this.usersService.findByEmail(stellarEmail).catch(() => null);
    if (!user) {
      const created = await this.usersService.create({
        email: stellarEmail,
        password: `Stellar-sep10-${randomBytes(16).toString('hex')}1A`,
      });
      user = (await this.usersService.findByEmail(stellarEmail).catch(() => null)) ?? {
        ...created,
      };
      this.logger.info(
        { userId: (user as { id?: string })?.id, stellarAccount: clientAccount },
        'User bound to Stellar account via SEP-10',
      );
    }

    const userId = (user as { id: string }).id;
    const login = await this.authService.completeOAuthLogin(userId, ipAddress, userAgent);

    return { ...login, stellarAccount: clientAccount } as {
      access_token: string;
      refresh_token: string;
      user: unknown;
      stellarAccount: string;
    };
  }

  async verifySep10Token(token: string): Promise<string> {
    let payload: { sub?: string };
    try {
      payload = await this.jwtService.verifyAsync<{ sub?: string }>(token);
    } catch {
      throw new UnauthorizedException('Invalid SEP-10 bearer token');
    }
    if (!payload.sub) {
      throw new UnauthorizedException('Invalid SEP-10 bearer token');
    }
    const user = await this.usersService.findByIdWithSecrets(payload.sub);
    const marker = '@stellar.sep10.local';
    if (
      !user ||
      !user.isActive ||
      user.status !== 'ACTIVE' ||
      user.deletedAt ||
      !user.email.toLowerCase().endsWith(marker)
    ) {
      throw new ForbiddenException(
        'A SEP-10 authenticated sending anchor is required',
      );
    }
    const account = user.email.slice(0, -marker.length).toUpperCase();
    if (!StellarSdk.StrKey.isValidEd25519PublicKey(account)) {
      throw new ForbiddenException(
        'The SEP-10 account associated with this token is invalid',
      );
    }
    return account;
  }

  private hasSignatureFrom(tx: StellarSdk.Transaction, accountId: string): boolean {
    try {
      const hash = tx.hash();
      const signatures = (tx.signatures ?? []) as Array<{ signature: () => Buffer }>;
      const keypair = StellarSdk.Keypair.fromPublicKey(accountId);
      return signatures.some((decorated) => {
        try {
          const raw = typeof decorated.signature === 'function' ? decorated.signature() : null;
          if (!raw) return false;
          return keypair.verify(hash, raw);
        } catch {
          return false;
        }
      });
    } catch {
      return false;
    }
  }

  private pruneChallenges(): void {
    const now = Date.now();
    for (const [key, record] of this.challenges.entries()) {
      if (record.expiresAt <= now) {
        this.challenges.delete(key);
      }
    }
  }
}

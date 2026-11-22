import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'crypto';
import * as StellarSdk from '@stellar/stellar-sdk';
import { Repository } from 'typeorm';
import { Sep10Service } from '../auth/sep10.service';
import { PaymentsService } from '../payments/payments.service';
import { CreatePaymentDto } from '../payments/dto/create-payment.dto';
import { PaymentStatus } from '../payments/payment.entity';
import { UsersService } from '../users/users.service';
import { CreateSep31TransactionDto } from './dto/create-sep31-transaction.dto';
import { UpdateSep12CustomerDto } from './dto/update-sep12-customer.dto';
import { Sep31Customer } from './entities/sep31-customer.entity';
import { Sep31Transaction } from './entities/sep31-transaction.entity';

interface Sep31AssetInfo {
  quotes_supported: boolean;
  quotes_required: boolean;
  fee_fixed?: number;
  fee_percent?: number;
  min_amount?: number;
  max_amount?: number;
  funding_methods: string[];
  sep12: {
    sender: { types: Record<string, { description: string }> };
    receiver: { types: Record<string, { description: string }> };
  };
}

@Injectable()
export class Sep31Service {
  constructor(
    @InjectRepository(Sep31Customer)
    private readonly customerRepo: Repository<Sep31Customer>,
    @InjectRepository(Sep31Transaction)
    private readonly transactionRepo: Repository<Sep31Transaction>,
    private readonly sep10Service: Sep10Service,
    private readonly paymentsService: PaymentsService,
    private readonly usersService: UsersService,
    private readonly configService: ConfigService,
  ) {}

  async authenticate(authorization?: string): Promise<string> {
    const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
    if (!token) {
      throw new ForbiddenException('SEP-10 bearer token required');
    }
    let account: string;
    try {
      account = await this.sep10Service.verifySep10Token(token);
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw new ForbiddenException('Invalid SEP-10 bearer token');
      }
      if (error instanceof ForbiddenException) throw error;
      throw error;
    }
    const allowed = this.configService
      .get<string>('SEP31_SENDING_ANCHOR_ACCOUNTS', '')
      .split(',')
      .map((value) => value.trim().toUpperCase())
      .filter(Boolean);
    if (!allowed.includes(account.toUpperCase())) {
      throw new ForbiddenException('Sending anchor is not authorized for SEP-31');
    }
    return account;
  }

  getInfo(): { receive: Record<string, Sep31AssetInfo> } {
    const receive: Record<string, Sep31AssetInfo> = {};
    for (const asset of this.getConfiguredAssets()) {
      receive[asset.code] = {
        quotes_supported: false,
        quotes_required: false,
        ...(this.readOptionalNumber('SEP31_FEE_FIXED') !== undefined
          ? { fee_fixed: this.readOptionalNumber('SEP31_FEE_FIXED') }
          : {}),
        ...(this.readOptionalNumber('SEP31_FEE_PERCENT') !== undefined
          ? { fee_percent: this.readOptionalNumber('SEP31_FEE_PERCENT') }
          : {}),
        ...(this.readOptionalNumber('SEP31_MIN_AMOUNT') !== undefined
          ? { min_amount: this.readOptionalNumber('SEP31_MIN_AMOUNT') }
          : {}),
        ...(this.readOptionalNumber('SEP31_MAX_AMOUNT') !== undefined
          ? { max_amount: this.readOptionalNumber('SEP31_MAX_AMOUNT') }
          : {}),
        funding_methods: this.configService
          .get<string>('SEP31_FUNDING_METHODS', 'BANK_ACCOUNT')
          .split(',')
          .map((value) => value.trim())
          .filter(Boolean),
        sep12: {
          sender: {
            types: {
              sep31_sender: {
                description: `Sending client fields: ${this.requiredCustomerFields('sender').join(', ')}`,
              },
            },
          },
          receiver: {
            types: {
              sep31_receiver: {
                description: `Receiving client fields: ${this.requiredCustomerFields('receiver').join(', ')}`,
              },
            },
          },
        },
      };
    }
    return { receive };
  }

  async updateCustomer(
    senderAccount: string,
    dto: UpdateSep12CustomerDto,
  ): Promise<{ id: string; status: string }> {
    const type = this.normalizeCustomerType(dto.type);
    const suppliedFields = dto.fields ?? {};
    if (
      (dto.id && !this.isUuid(dto.id)) ||
      (dto.transaction_id && !this.isUuid(dto.transaction_id)) ||
      (dto.merchant_id && !this.isUuid(dto.merchant_id))
    ) {
      throw new BadRequestException('Customer, transaction, and merchant IDs must be UUIDs');
    }
    if (
      !suppliedFields ||
      typeof suppliedFields !== 'object' ||
      Array.isArray(suppliedFields)
    ) {
      throw new BadRequestException('SEP-12 customer fields must be an object');
    }
    let customer: Sep31Customer | null = null;
    let customerId = dto.id;
    if (dto.transaction_id && !customerId) {
      const transaction = await this.transactionRepo.findOne({
        where: { id: dto.transaction_id, senderAccount },
      });
      if (!transaction) {
        throw new NotFoundException('SEP-31 transaction not found');
      }
      customerId = type === 'sender' ? transaction.senderId : transaction.receiverId;
    }

    if (customerId) {
      customer = await this.customerRepo.findOne({
        where: { id: customerId, senderAccount, type },
      });
      if (!customer) {
        throw new NotFoundException('SEP-12 customer not found');
      }
    } else {
      customer = this.customerRepo.create({
        senderAccount,
        type,
        merchantId: null,
        status: 'NEEDS_INFO',
        encryptedFields: null,
      });
    }

    if (type === 'receiver') {
      const merchantId = dto.merchant_id ?? customer.merchantId;
      if (!merchantId) {
        throw new BadRequestException(
          'merchant_id is required when registering a receiver',
        );
      }
      await this.usersService.findOne(merchantId);
      await this.usersService.assertMerchantActive(merchantId);
      customer.merchantId = merchantId;
    }

    const fields = {
      ...(customer.encryptedFields
        ? this.decryptFields(customer.encryptedFields)
        : {}),
      ...suppliedFields,
    };
    if (Object.keys(fields).length === 0) {
      throw new BadRequestException('At least one SEP-12 customer field is required');
    }
    customer.encryptedFields = this.encryptFields(fields);
    const requiredFields = this.requiredCustomerFields(type);
    customer.status = requiredFields.every((field) => {
      const value = fields[field];
      return (
        value !== undefined &&
        value !== null &&
        (typeof value !== 'string' || value.trim().length > 0)
      );
    })
      ? 'ACCEPTED'
      : 'NEEDS_INFO';
    const saved = await this.customerRepo.save(customer);
    return { id: saved.id, status: saved.status };
  }

  async getCustomer(
    senderAccount: string,
    id: string | undefined,
    type: string,
    transactionId?: string,
  ): Promise<{ id: string; status: string; fields: Record<string, unknown> }> {
    const customerType = this.normalizeCustomerType(type);
    let customerId = id;
    if (transactionId && !customerId) {
      if (!this.isUuid(transactionId)) {
        throw new BadRequestException('transaction_id must be a valid UUID');
      }
      const transaction = await this.transactionRepo.findOne({
        where: { id: transactionId, senderAccount },
      });
      if (!transaction) {
        throw new NotFoundException('SEP-31 transaction not found');
      }
      customerId =
        customerType === 'sender' ? transaction.senderId : transaction.receiverId;
    }
    if (!customerId || !this.isUuid(customerId)) {
      throw new BadRequestException(
        'A valid customer id or transaction_id is required',
      );
    }
    const customer = await this.customerRepo.findOne({
      where: { id: customerId, senderAccount, type: customerType },
    });
    if (!customer) {
      throw new NotFoundException('SEP-12 customer not found');
    }
    return {
      id: customer.id,
      status: customer.status,
      fields: customer.encryptedFields
        ? this.decryptFields(customer.encryptedFields)
        : {},
    };
  }

  async createTransaction(
    senderAccount: string,
    dto: CreateSep31TransactionDto,
  ): Promise<{ id: string }> {
    if (dto.fields) {
      throw new BadRequestException(
        'Transaction fields are not supported; submit customer information through SEP-12',
      );
    }
    if (dto.destination_asset || dto.quote_id) {
      throw new BadRequestException(
        'SEP-38 quotes and destination asset conversion are not supported',
      );
    }
    const amount = Number(dto.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new BadRequestException('amount must be greater than zero');
    }
    const assetCode = dto.asset_code.trim().toUpperCase();
    const configuredAsset = this.getConfiguredAssets().find(
      (asset) => asset.code === assetCode,
    );
    if (!configuredAsset || configuredAsset.issuer !== (dto.asset_issuer ?? null)) {
      throw new BadRequestException('The requested asset is not supported');
    }
    const minAmount = this.readOptionalNumber('SEP31_MIN_AMOUNT');
    const maxAmount = this.readOptionalNumber('SEP31_MAX_AMOUNT');
    if (minAmount !== undefined && amount < minAmount) {
      throw new BadRequestException(`amount must be at least ${minAmount}`);
    }
    if (maxAmount !== undefined && amount > maxAmount) {
      throw new BadRequestException(`amount must not exceed ${maxAmount}`);
    }
    if (!/^\d+(\.\d{1,2})?$/.test(String(dto.amount))) {
      throw new BadRequestException(
        'amount must have no more than 2 decimal places for FacilPay payments',
      );
    }

    const [sender, receiver] = await Promise.all([
      this.customerRepo.findOne({
        where: { id: dto.sender_id, senderAccount, type: 'sender' },
      }),
      this.customerRepo.findOne({
        where: { id: dto.receiver_id, type: 'receiver' },
      }),
    ]);
    if (!sender || sender.status !== 'ACCEPTED') {
      throw new BadRequestException('sender_id is not an accepted SEP-12 customer');
    }
    if (receiver?.senderAccount !== senderAccount) {
      throw new BadRequestException(
        'receiver_id is not registered by this sending anchor',
      );
    }
    if (!receiver || receiver.status !== 'ACCEPTED' || !receiver.merchantId) {
      throw new BadRequestException(
        'receiver_id is not an accepted merchant recipient',
      );
    }

    const secret = this.configService.get<string>('STELLAR_SOURCE_SECRET');
    if (!secret) {
      throw new ServiceUnavailableException(
        'SEP-31 receiving Stellar account is not configured',
      );
    }
    const stellarAccountId = StellarSdk.Keypair.fromSecret(secret).publicKey();
    const stellarMemo = randomBytes(16).toString('base64url');
    const paymentInput: CreatePaymentDto & { externalReference: string } = {
      amount,
      currency: assetCode,
      merchantId: receiver.merchantId,
      description: `SEP-31 cross-border payment from ${senderAccount}`,
      externalReference: stellarMemo,
    };
    const payment = await this.paymentsService.create(paymentInput);
    const transaction = this.transactionRepo.create({
      paymentId: payment.id,
      merchantId: receiver.merchantId,
      senderId: sender.id,
      receiverId: receiver.id,
      senderAccount,
      assetCode,
      assetIssuer: configuredAsset.issuer,
      amount: amount.toFixed(2),
      stellarMemo,
      stellarAccountId,
      status: 'pending_sender',
    });
    const saved = await this.transactionRepo.save(transaction);
    return { id: saved.id };
  }

  async getTransaction(
    senderAccount: string,
    id: string,
  ): Promise<Record<string, unknown>> {
    if (!this.isUuid(id)) {
      throw new BadRequestException('id must be a valid transaction UUID');
    }
    const transaction = await this.transactionRepo.findOne({
      where: { id, senderAccount },
    });
    if (!transaction) {
      throw new NotFoundException('SEP-31 transaction not found');
    }
    const payment = await this.paymentsService.findOne(transaction.paymentId);
    if (payment.status === PaymentStatus.COMPLETED) {
      transaction.status = 'completed';
      await this.transactionRepo.save(transaction);
    } else if (
      [PaymentStatus.FAILED, PaymentStatus.CANCELLED, PaymentStatus.EXPIRED].includes(
        payment.status,
      )
    ) {
      transaction.status = 'error';
      await this.transactionRepo.save(transaction);
    }
    return {
      id: transaction.id,
      status: transaction.status,
      amount_in: transaction.amount,
      amount_in_asset: transaction.assetIssuer
        ? `${transaction.assetCode}:${transaction.assetIssuer}`
        : transaction.assetCode,
      stellar_account_id: transaction.stellarAccountId,
      stellar_memo: transaction.stellarMemo,
      stellar_memo_type: 'text',
      started_at: transaction.startedAt.toISOString(),
      ...(transaction.status === 'completed'
        ? { completed_at: transaction.updatedAt.toISOString() }
        : {}),
    };
  }

  private getConfiguredAssets(): Array<{ code: string; issuer: string | null }> {
    const configured = this.configService.get<string>('SEP31_RECEIVE_ASSETS', 'XLM');
    const assets = configured
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)
      .map((value) => {
        const [code, issuer, ...extra] = value.split(':');
        if (
          extra.length ||
          !/^[A-Z0-9]{1,12}$/.test(code) ||
          (code !== 'XLM' && !issuer) ||
          (code === 'XLM' && issuer !== undefined) ||
          (issuer !== undefined &&
            (!/^[A-Z2-7]{56}$/.test(issuer) ||
              !StellarSdk.StrKey.isValidEd25519PublicKey(issuer)))
        ) {
          throw new ServiceUnavailableException(
            `Invalid SEP31_RECEIVE_ASSETS entry: ${value}`,
          );
        }
        return { code, issuer: issuer ?? null };
      });
    const codes = new Set<string>();
    for (const asset of assets) {
      if (codes.has(asset.code)) {
        throw new ServiceUnavailableException(
          `SEP31_RECEIVE_ASSETS contains duplicate asset code: ${asset.code}`,
        );
      }
      codes.add(asset.code);
    }
    return assets;
  }

  private readOptionalNumber(key: string): number | undefined {
    const value = this.configService.get<string>(key);
    if (value === undefined || value.trim() === '') return undefined;
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) {
      throw new ServiceUnavailableException(`${key} must be a non-negative number`);
    }
    return parsed;
  }

  private normalizeCustomerType(type: string): 'sender' | 'receiver' {
    if (type === 'sender' || type === 'sep31_sender') return 'sender';
    if (type === 'receiver' || type === 'sep31_receiver') return 'receiver';
    throw new BadRequestException('type must be sep31_sender or sep31_receiver');
  }

  private requiredCustomerFields(type: 'sender' | 'receiver'): string[] {
    const key =
      type === 'sender'
        ? 'SEP31_REQUIRED_SENDER_FIELDS'
        : 'SEP31_REQUIRED_RECEIVER_FIELDS';
    const fields = this.configService
      .get<string>(key, 'first_name,last_name')
      .split(',')
      .map((field) => field.trim())
      .filter(Boolean);
    if (fields.some((field) => !/^[a-zA-Z0-9_]+$/.test(field))) {
      throw new ServiceUnavailableException(`${key} contains an invalid field name`);
    }
    return fields;
  }

  private isUuid(value: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    );
  }

  private encryptionKey(): Buffer {
    const configured = this.configService.get<string>('SEP31_PII_ENCRYPTION_KEY');
    if (!configured || configured.length < 32) {
      throw new ServiceUnavailableException(
        'SEP31_PII_ENCRYPTION_KEY must be configured with at least 32 characters',
      );
    }
    return createHash('sha256').update(configured, 'utf8').digest();
  }

  private encryptFields(fields: Record<string, unknown>): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.encryptionKey(), iv);
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(fields), 'utf8'),
      cipher.final(),
    ]);
    return [iv, cipher.getAuthTag(), ciphertext]
      .map((part) => part.toString('base64url'))
      .join('.');
  }

  private decryptFields(value: string): Record<string, unknown> {
    const [iv, tag, ciphertext] = value.split('.');
    if (!iv || !tag || !ciphertext) {
      throw new ServiceUnavailableException('Stored SEP-12 customer data is invalid');
    }
    const decipher = createDecipheriv(
      'aes-256-gcm',
      this.encryptionKey(),
      Buffer.from(iv, 'base64url'),
    );
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(ciphertext, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
    const parsed: unknown = JSON.parse(plaintext);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new ServiceUnavailableException('Stored SEP-12 customer data is invalid');
    }
    return parsed as Record<string, unknown>;
  }
}

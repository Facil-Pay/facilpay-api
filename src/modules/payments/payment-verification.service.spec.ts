import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

jest.mock('../logger/logger.service', () => ({
  AppLogger: class AppLogger {
    child() {
      return { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    }
  },
}));

import { PaymentVerificationService } from './payment-verification.service';
import { Payment, PaymentStatus } from './payment.entity';
import { PaymentVerificationLog } from './entities/payment-verification-log.entity';
import { StellarHorizonClientService } from '../stellar/stellar-horizon-client.service';
import { AppLogger } from '../logger/logger.service';

// ── helpers ──────────────────────────────────────────────────────────────────

const MERCHANT_ACCOUNT = 'GABCMERCHANT000000000000000000000000000000000000000000000001';

function makePaymentRepo(overrides: Partial<Record<string, jest.Mock>> = {}) {
  return {
    findOneBy: jest.fn(),
    save: jest.fn().mockImplementation((p: any) => Promise.resolve(p)),
    ...overrides,
  };
}

function makeLogRepo() {
  return {
    create: jest.fn().mockImplementation((d: any) => d),
    save: jest.fn().mockResolvedValue({}),
  };
}

function makeHorizonClient(txRecord: any, ops: any[]) {
  const server = {
    transactions: jest.fn().mockReturnValue({
      transaction: jest.fn().mockReturnValue({
        call: jest.fn().mockResolvedValue(txRecord),
      }),
    }),
    operations: jest.fn().mockReturnValue({
      forTransaction: jest.fn().mockReturnValue({
        call: jest.fn().mockResolvedValue({ records: ops }),
      }),
    }),
  };
  return {
    getHealthyServer: jest.fn().mockReturnValue(server),
  };
}

function makePayment(overrides: Partial<Payment> = {}): Payment {
  return {
    id: 'pay-1',
    amount: 100,
    currency: 'USDC',
    status: PaymentStatus.PENDING,
    externalReference: 'REF-001',
    description: null,
    callbackUrl: null,
    refundedAmount: 0,
    overpaidAmount: 0,
    overpaymentPolicy: 'KEEP' as any,
    feeAmount: 0,
    netAmount: 0,
    feeBreakdown: null,
    cancelledAt: null,
    expiresAt: null,
    expiredAt: null,
    merchantId: 'merchant-1',
    customerId: null,
    recurringPaymentId: null,
    merchantEmail: null,
    payerEmail: null,
    payerName: null,
    payerPhone: null,
    payerLocale: null,
    metadata: null,
    tags: [],
    settlementId: null,
    paymentLinkId: null,
    invoiceId: null,
    couponId: null,
    discountAmount: 0,
    couponRedemptionReserved: false,
    dueDate: null,
    remindersEnabled: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makePayOp(overrides: Partial<Record<string, any>> = {}) {
  return {
    type: 'payment',
    to: MERCHANT_ACCOUNT,
    from: 'GPAYER000000000000000000000000000000000000000000000000000001',
    asset_type: 'credit_alphanum4',
    asset_code: 'USDC',
    amount: '100.0000000',
    ...overrides,
  };
}

function makeTxRecord(overrides: Partial<Record<string, any>> = {}) {
  return {
    source_account: 'GPAYER000000000000000000000000000000000000000000000000000001',
    created_at: '2026-01-26T10:00:00Z',
    memo: 'REF-001',
    // No envelope_xdr so memo fallback path is taken
    ...overrides,
  };
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe('PaymentVerificationService', () => {
  let service: PaymentVerificationService;
  let paymentRepo: ReturnType<typeof makePaymentRepo>;
  let logRepo: ReturnType<typeof makeLogRepo>;
  let horizonClient: ReturnType<typeof makeHorizonClient>;

  async function buildService(
    txRecord: any,
    ops: any[],
    paymentOverrides: Partial<Payment> = {},
  ) {
    paymentRepo = makePaymentRepo({
      findOneBy: jest.fn().mockResolvedValue(makePayment(paymentOverrides)),
    });
    logRepo = makeLogRepo();
    horizonClient = makeHorizonClient(txRecord, ops);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentVerificationService,
        { provide: getRepositoryToken(Payment), useValue: paymentRepo },
        { provide: getRepositoryToken(PaymentVerificationLog), useValue: logRepo },
        {
          provide: StellarHorizonClientService,
          useValue: horizonClient,
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockImplementation((key: string, def?: any) => {
              if (key === 'STELLAR_MERCHANT_ACCOUNT_ID') return MERCHANT_ACCOUNT;
              if (key === 'STELLAR_NETWORK') return 'TESTNET';
              return def;
            }),
          },
        },
        { provide: AppLogger, useValue: new (AppLogger as any)() },
      ],
    }).compile();

    service = module.get(PaymentVerificationService);
  }

  afterEach(() => jest.clearAllMocks());

  // ── payment not found ─────────────────────────────────────────────────────

  it('throws NotFoundException when the payment does not exist', async () => {
    await buildService(makeTxRecord(), [makePayOp()]);
    paymentRepo.findOneBy.mockResolvedValue(null);

    await expect(
      service.verifyTransaction('missing', 'some-hash', false),
    ).rejects.toThrow(NotFoundException);
  });

  // ── tx not on-chain ───────────────────────────────────────────────────────

  it('throws BadRequestException when the transaction is not found on Horizon', async () => {
    await buildService(makeTxRecord(), [makePayOp()]);
    const server = horizonClient.getHealthyServer();
    server.transactions().transaction('').call = jest.fn().mockRejectedValue({ status: 404 });

    await expect(
      service.verifyTransaction('pay-1', 'bad-hash', false),
    ).rejects.toThrow(BadRequestException);
  });

  // ── fully matched ─────────────────────────────────────────────────────────

  it('returns matched=true with no mismatches when all fields align', async () => {
    await buildService(makeTxRecord(), [makePayOp()]);

    const result = await service.verifyTransaction('pay-1', 'txhash', false);

    expect(result.matched).toBe(true);
    expect(result.mismatches).toHaveLength(0);
    expect(result.paymentCompleted).toBe(false);
  });

  // ── destination mismatch ──────────────────────────────────────────────────

  it('reports a destination mismatch when the payment op goes to a different account', async () => {
    await buildService(
      makeTxRecord(),
      [makePayOp({ to: 'GWRONG000000000000000000000000000000000000000000000000000001' })],
    );

    const result = await service.verifyTransaction('pay-1', 'txhash', false);

    expect(result.matched).toBe(false);
    expect(result.mismatches.some((m) => m.field === 'destination')).toBe(true);
  });

  // ── asset mismatch ────────────────────────────────────────────────────────

  it('reports an asset mismatch when the asset code differs', async () => {
    await buildService(
      makeTxRecord(),
      [makePayOp({ asset_code: 'XLM', asset_type: 'native' })],
    );

    const result = await service.verifyTransaction('pay-1', 'txhash', false);

    expect(result.matched).toBe(false);
    expect(result.mismatches.some((m) => m.field === 'assetCode')).toBe(true);
  });

  // ── amount underpaid ──────────────────────────────────────────────────────

  it('reports an amount mismatch when the on-chain amount is less than expected', async () => {
    await buildService(
      makeTxRecord(),
      [makePayOp({ amount: '50.0000000' })],
    );

    const result = await service.verifyTransaction('pay-1', 'txhash', false);

    expect(result.matched).toBe(false);
    expect(result.mismatches.some((m) => m.field === 'amount')).toBe(true);
  });

  // ── memo mismatch ─────────────────────────────────────────────────────────

  it('reports a memo mismatch when the memo does not match externalReference', async () => {
    await buildService(
      makeTxRecord({ memo: 'WRONG-MEMO' }),
      [makePayOp()],
    );

    const result = await service.verifyTransaction('pay-1', 'txhash', false);

    expect(result.matched).toBe(false);
    expect(result.mismatches.some((m) => m.field === 'memo')).toBe(true);
  });

  // ── no memo required ──────────────────────────────────────────────────────

  it('skips the memo check when the payment has no externalReference', async () => {
    await buildService(
      makeTxRecord({ memo: null }),
      [makePayOp()],
      { externalReference: null },
    );

    const result = await service.verifyTransaction('pay-1', 'txhash', false);

    expect(result.mismatches.some((m) => m.field === 'memo')).toBe(false);
  });

  // ── completeOnMatch ───────────────────────────────────────────────────────

  it('completes a PENDING payment when matched and completeOnMatch=true', async () => {
    await buildService(makeTxRecord(), [makePayOp()]);

    const result = await service.verifyTransaction('pay-1', 'txhash', true);

    expect(result.matched).toBe(true);
    expect(result.paymentCompleted).toBe(true);
    expect(paymentRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ status: PaymentStatus.COMPLETED }),
    );
  });

  it('does not complete a payment when matched but completeOnMatch=false', async () => {
    await buildService(makeTxRecord(), [makePayOp()]);

    const result = await service.verifyTransaction('pay-1', 'txhash', false);

    expect(result.paymentCompleted).toBe(false);
    expect(paymentRepo.save).not.toHaveBeenCalled();
  });

  it('does not complete an already-completed payment even when completeOnMatch=true', async () => {
    await buildService(makeTxRecord(), [makePayOp()], {
      status: PaymentStatus.COMPLETED,
    });

    const result = await service.verifyTransaction('pay-1', 'txhash', true);

    expect(result.paymentCompleted).toBe(false);
    expect(paymentRepo.save).not.toHaveBeenCalled();
  });

  // ── multiple mismatches ───────────────────────────────────────────────────

  it('reports all mismatched fields in one call', async () => {
    await buildService(
      makeTxRecord({ memo: 'WRONG' }),
      [
        makePayOp({
          to: 'GWRONG000000000000000000000000000000000000000000000000000001',
          asset_code: 'XLM',
          asset_type: 'native',
          amount: '1.0000000',
        }),
      ],
    );

    const result = await service.verifyTransaction('pay-1', 'txhash', false);

    expect(result.matched).toBe(false);
    const fields = result.mismatches.map((m) => m.field);
    expect(fields).toContain('destination');
    expect(fields).toContain('assetCode');
    expect(fields).toContain('amount');
    expect(fields).toContain('memo');
  });

  // ── audit log ─────────────────────────────────────────────────────────────

  it('persists a verification log entry after the call', async () => {
    await buildService(makeTxRecord(), [makePayOp()]);

    await service.verifyTransaction('pay-1', 'txhash', false, 'actor-id');

    // Allow the fire-and-forget promise to resolve
    await new Promise((r) => setTimeout(r, 10));

    expect(logRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        paymentId: 'pay-1',
        transactionHash: 'txhash',
        matched: true,
        requestedBy: 'actor-id',
      }),
    );
  });
});

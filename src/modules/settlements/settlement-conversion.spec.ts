jest.mock('../../tracing', () => ({
  getTraceId: jest.fn(),
  initializeTracing: jest.fn(),
}));
jest.mock('../ledger/ledger-transaction', () => ({
  appendLedgerTransaction: jest.fn().mockResolvedValue([]),
}));

import {
  MerchantSettlementConfig,
  SettlementSchedule,
} from './entities/merchant-settlement-config.entity';
import { SettlementStatus } from './entities/settlement.entity';
import { PaymentStatus } from '../payments/payment.entity';
import { SettlementsService } from './settlements.service';

const ISSUER = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
const PREFERRED = `USDC:${ISSUER}`;

function setup(
  options: {
    paymentAssets?: Array<{ assetCode: string; assetIssuer?: string }>;
    quoteSlippage?: number | null;
    executedAmount?: string;
    conversionStatus?: string;
  } = {},
) {
  const paymentAssets = options.paymentAssets ?? [
    { assetCode: 'XLM' },
    { assetCode: 'USDC', assetIssuer: ISSUER },
  ];
  const payments = paymentAssets.map((asset, index) => ({
    id: `payment-${index}`,
    amount: index === 0 ? 100 : 50,
    netAmount: index === 0 ? 95 : 47.5,
    feeAmount: 5,
    currency: 'USD',
    status: PaymentStatus.COMPLETED,
    metadata: asset,
  }));

  const config: MerchantSettlementConfig = {
    id: 'config-1',
    userId: 'merchant-1',
    schedule: SettlementSchedule.DAILY,
    currency: 'USD',
    settlementAsset: PREFERRED,
    maxSlippagePercent: 0.5,
    destinationId: 'destination-1',
    reservePercent: 0,
    reserveDays: 0,
    totalReservedAmount: 0,
    lastSettledAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const paymentQuery = {
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    getMany: jest.fn().mockResolvedValue(payments),
  };
  const lockQuery = {
    setLock: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    getOne: jest.fn().mockResolvedValue(config),
  };
  const manager = {
    createQueryBuilder: jest.fn((entity: unknown) =>
      entity === MerchantSettlementConfig ? lockQuery : paymentQuery,
    ),
    find: jest.fn().mockResolvedValue([]),
    create: jest.fn((_entity: unknown, payload: unknown) => payload),
    save: jest.fn(async (payload: any) => ({ id: 'settlement-1', ...payload })),
    update: jest.fn(),
  };
  const runner = {
    manager,
    connect: jest.fn(),
    startTransaction: jest.fn(),
    commitTransaction: jest.fn(),
    rollbackTransaction: jest.fn(),
    release: jest.fn(),
  };

  const quote = {
    mode: 'strict-send' as const,
    sourceAsset: 'XLM',
    destAsset: PREFERRED,
    amount: '95',
    sourceAmount: '95',
    destAmount: '94.5',
    path: [],
    slippageEstimatePercent:
      options.quoteSlippage === undefined ? 0.1 : options.quoteSlippage,
    slippageEstimateBasis: 'next-best-path' as const,
    cached: false,
  };
  const horizonClientService = {
    getPathQuote: jest.fn().mockResolvedValue(quote),
  };
  const stellarService = {
    convertAsset: jest.fn().mockResolvedValue({
      status: options.conversionStatus ?? 'ok',
      hash: options.conversionStatus ? undefined : 'CONVERSION_HASH',
      destAmount: options.executedAmount ?? '94.4',
      fee: '0.00001',
    }),
  };
  const failedSettlementRepo = {
    create: jest.fn((payload: unknown) => payload),
    save: jest.fn(async (payload: unknown) => ({
      id: 'failed-settlement',
      ...payload,
    })),
  };

  const service = Object.assign(Object.create(SettlementsService.prototype), {
    settleOnGross: false,
    dataSource: { createQueryRunner: jest.fn().mockReturnValue(runner) },
    usersService: {
      findOne: jest.fn().mockResolvedValue({ status: 'ACTIVE' }),
    },
    getEligibleDestination: jest.fn().mockResolvedValue({
      id: 'destination-1',
      assetCode: 'USDC',
      stellarAddress: 'GDESTINATION',
      verifiedAt: new Date(),
      coolingOffUntil: null,
    }),
    horizonClientService,
    stellarService,
    settlementRepo: failedSettlementRepo,
    dispatchSettlementEvents: jest.fn(),
    sendSettlementEmail: jest.fn(),
  }) as unknown as SettlementsService;

  return {
    service,
    config,
    runner,
    manager,
    horizonClientService,
    stellarService,
    failedSettlementRepo,
  };
}

describe('Settlement conversion to a preferred Stellar asset', () => {
  it('converts non-matching balances and records rate, slippage, fees and transaction hash', async () => {
    const { service, config, runner, horizonClientService, stellarService } =
      setup();

    const settlement = await (service as any).processMerchantSettlement(config);

    expect(horizonClientService.getPathQuote).toHaveBeenCalledWith(
      'XLM',
      PREFERRED,
      '95',
      'strict-send',
    );
    expect(stellarService.convertAsset).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceAmount: '95',
        destMin: '94.0275000',
        destination: 'GDESTINATION',
      }),
    );
    expect(settlement).toMatchObject({
      status: SettlementStatus.COMPLETED,
      settlementAsset: PREFERRED,
      sourceAsset: 'XLM',
      sourceAmount: 95,
      destAmount: 94.4,
      conversionRate: 0.99368421,
      slippagePercent: 0.10582,
      conversionFee: 0.00001,
      conversionTransactionHash: 'CONVERSION_HASH',
    });
    expect(runner.commitTransaction).toHaveBeenCalledTimes(1);
  });

  it('does not convert when every payment already uses the preferred asset', async () => {
    const { service, config, horizonClientService, stellarService } = setup({
      paymentAssets: [
        { assetCode: 'USDC', assetIssuer: ISSUER },
        { assetCode: 'USDC', assetIssuer: ISSUER },
      ],
    });

    const settlement = await (service as any).processMerchantSettlement(config);

    expect(horizonClientService.getPathQuote).not.toHaveBeenCalled();
    expect(stellarService.convertAsset).not.toHaveBeenCalled();
    expect(settlement.settlementAsset).toBeNull();
    expect(settlement.conversionTransactionHash).toBeNull();
  });

  it('fails safely before executing anything when the quoted slippage exceeds the limit', async () => {
    const { service, config, runner, stellarService, failedSettlementRepo } =
      setup({
        quoteSlippage: 1.5,
      });

    await expect(
      (service as any).processMerchantSettlement(config),
    ).rejects.toThrow(/slippage/i);

    expect(stellarService.convertAsset).not.toHaveBeenCalled();
    expect(runner.commitTransaction).not.toHaveBeenCalled();
    expect(failedSettlementRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        status: SettlementStatus.FAILED,
        settlementAsset: PREFERRED,
        failureReason: expect.stringMatching(/slippage/i),
      }),
    );
  });

  it('fails safely when the executed amount is worse than destMin', async () => {
    const { service, config, runner, failedSettlementRepo } = setup({
      executedAmount: '94.0',
    });

    await expect(
      (service as any).processMerchantSettlement(config),
    ).rejects.toThrow(/slippage/i);

    expect(runner.commitTransaction).not.toHaveBeenCalled();
    expect(failedSettlementRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ status: SettlementStatus.FAILED }),
    );
  });

  it('leaves the settlement pending when the conversion requires more signatures', async () => {
    const { service, config, runner, manager } = setup({
      conversionStatus: 'pending_signatures',
    });

    const settlement = await (service as any).processMerchantSettlement(config);

    expect(settlement.status).toBe(SettlementStatus.PENDING);
    expect(settlement.conversionTransactionHash).toBeNull();
    expect(manager.save).not.toHaveBeenCalledWith(
      expect.objectContaining({ status: SettlementStatus.COMPLETED }),
    );
    expect(runner.commitTransaction).toHaveBeenCalledTimes(1);
  });
});

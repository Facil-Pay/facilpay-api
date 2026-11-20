jest.mock('../../tracing', () => ({
  getTraceId: jest.fn(),
  initializeTracing: jest.fn(),
}));
jest.mock('../ledger/ledger-transaction', () => ({
  appendLedgerTransaction: jest.fn().mockResolvedValue([]),
}));

import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import { SettlementsService } from './settlements.service';
import { Settlement } from './entities/settlement.entity';
import {
  MerchantSettlementConfig,
  SettlementSchedule,
} from './entities/merchant-settlement-config.entity';
import { Payment, PaymentStatus } from '../payments/payment.entity';
import { SettlementAdjustment } from './entities/settlement-adjustment.entity';
import { PayoutDestination } from './entities/payout-destination.entity';
import { Refund } from '../payments/refund.entity';
import { DataSource } from 'typeorm';
import { MailService } from '../auth/mail/mail.service';
import { UsersService } from '../users/users.service';
import { WebhooksService } from '../webhooks/webhooks.service';
import { EventsService } from '../events/events.service';
import { AuthService } from '../auth/auth.service';
import { StellarService } from '../stellar/stellar.service';
import { StellarHorizonClientService } from '../stellar/stellar-horizon-client.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';

describe('SettlementsService', () => {
  let service: SettlementsService;
  let settlementRepo: Repository<Settlement>;
  let paymentRepo: Repository<Payment>;
  let configRepo: Repository<MerchantSettlementConfig>;
  let managerMock: any;

  const merchantId = 'merchant-1';
  const config: MerchantSettlementConfig = {
    id: 'config-1',
    userId: merchantId,
    schedule: SettlementSchedule.DAILY,
    currency: 'USD',
    settlementAsset: null,
    maxSlippagePercent: 0.5,
    destinationId: 'destination-1',
    reservePercent: 0,
    reserveDays: 0,
    totalReservedAmount: 0,
    lastSettledAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const completedPayments = [
    {
      id: 'payment-1',
      amount: 100,
      netAmount: 95,
      feeAmount: 5,
      status: PaymentStatus.COMPLETED,
      currency: 'USD',
      merchantId,
      updatedAt: new Date(),
    },
    {
      id: 'payment-2',
      amount: 50,
      netAmount: 47.5,
      feeAmount: 2.5,
      status: PaymentStatus.COMPLETED,
      currency: 'USD',
      merchantId,
      updatedAt: new Date(),
    },
  ] as Payment[];

  const buildModule = async (settlementUseGrossAmount = false) => {
    const queryBuilder = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue(completedPayments),
    };
    const lockQueryBuilder = {
      setLock: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue(config),
    };
    const manager = {
      createQueryBuilder: jest.fn((entity: unknown) =>
        entity === MerchantSettlementConfig ? lockQueryBuilder : queryBuilder,
      ),
      find: jest.fn().mockResolvedValue([]),
      create: jest.fn((_entity: unknown, payload: unknown) => payload),
      save: jest.fn(async (payload: any) => ({
        id: 'settlement-1',
        ...payload,
      })),
      update: jest.fn().mockResolvedValue(undefined),
    };
    managerMock = manager;
    const queryRunner = {
      manager,
      connect: jest.fn(),
      startTransaction: jest.fn(),
      commitTransaction: jest.fn(),
      rollbackTransaction: jest.fn(),
      release: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SettlementsService,
        {
          provide: getRepositoryToken(Settlement),
          useValue: {
            create: jest.fn().mockImplementation((payload) => payload),
            save: jest.fn().mockImplementation(async (payload) => ({
              ...payload,
              id: 'settlement-1',
            })),
            find: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(SettlementAdjustment),
          useValue: { find: jest.fn().mockResolvedValue([]) },
        },
        {
          provide: getRepositoryToken(MerchantSettlementConfig),
          useValue: {
            findOneBy: jest.fn(),
            find: jest.fn().mockResolvedValue([config]),
            save: jest.fn().mockResolvedValue(config),
          },
        },
        {
          provide: getRepositoryToken(Payment),
          useValue: {
            createQueryBuilder: jest.fn().mockReturnValue(queryBuilder),
            update: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: getRepositoryToken(PayoutDestination),
          useValue: {
            findOneBy: jest.fn().mockResolvedValue({
              id: 'destination-1',
              assetCode: 'USD',
              stellarAddress: 'GABC',
              verifiedAt: new Date(),
              coolingOffUntil: null,
            }),
            find: jest.fn().mockResolvedValue([]),
          },
        },
        {
          provide: getRepositoryToken(Refund),
          useValue: { find: jest.fn().mockResolvedValue([]) },
        },
        {
          provide: DataSource,
          useValue: {
            createQueryRunner: jest.fn().mockReturnValue(queryRunner),
          },
        },
        {
          provide: MailService,
          useValue: {
            sendSettlementNotification: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: UsersService,
          useValue: {
            findOne: jest
              .fn()
              .mockResolvedValue({
                email: 'merchant@test.com',
                status: 'ACTIVE',
              }),
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, defaultValue?: unknown) => {
              if (key === 'SETTLEMENT_USE_GROSS_AMOUNT') {
                return settlementUseGrossAmount ? 'true' : 'false';
              }
              return defaultValue;
            }),
          },
        },
        {
          provide: WebhooksService,
          useValue: { dispatchEventToMerchant: jest.fn() },
        },
        { provide: EventsService, useValue: { emit: jest.fn() } },
        { provide: AuthService, useValue: { validateStepUpToken: jest.fn() } },
        {
          provide: StellarService,
          useValue: {
            validatePayoutDestination: jest.fn(),
            convertAsset: jest.fn(),
          },
        },
        { provide: AuditLogsService, useValue: { record: jest.fn() } },
        {
          provide: StellarHorizonClientService,
          useValue: { getPathQuote: jest.fn() },
        },
      ],
    }).compile();

    service = module.get<SettlementsService>(SettlementsService);
    settlementRepo = module.get<Repository<Settlement>>(
      getRepositoryToken(Settlement),
    );
    configRepo = module.get<Repository<MerchantSettlementConfig>>(
      getRepositoryToken(MerchantSettlementConfig),
    );
    paymentRepo = module.get<Repository<Payment>>(getRepositoryToken(Payment));
  };

  it('settles with net amounts by default', async () => {
    await buildModule(false);

    const result = await service.triggerManualRun();

    expect(result.settlementsCreated).toBe(1);
    expect(result.totalAmount).toBe(142.5);
    expect(managerMock.create).toHaveBeenCalledWith(
      Settlement,
      expect.objectContaining({
        totalAmount: 142.5,
      }),
    );
  });

  it('can settle with gross amounts when configured', async () => {
    await buildModule(true);

    const result = await service.triggerManualRun();

    expect(result.settlementsCreated).toBe(1);
    expect(result.totalAmount).toBe(150);
    expect(managerMock.create).toHaveBeenCalledWith(
      Settlement,
      expect.objectContaining({
        totalAmount: 150,
      }),
    );
  });

  it('filters completed payments by merchantId when settling', async () => {
    await buildModule(false);

    await service.triggerManualRun();

    expect(managerMock.createQueryBuilder).toHaveBeenCalledWith(Payment, 'p');
    const paymentCallIndex =
      managerMock.createQueryBuilder.mock.calls.findIndex(
        ([entity]: [unknown]) => entity === Payment,
      );
    const queryBuilder =
      managerMock.createQueryBuilder.mock.results[paymentCallIndex].value;
    expect(queryBuilder.andWhere).toHaveBeenCalledWith(
      'p.merchantId = :merchantId',
      { merchantId: config.userId },
    );
  });

  it('updates config and payment settlement linkage after settlement', async () => {
    await buildModule(false);

    await service.triggerManualRun();

    expect(managerMock.save).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: merchantId,
        lastSettledAt: expect.any(Date),
      }),
    );
    expect(managerMock.update).toHaveBeenCalledWith(
      Payment,
      { id: expect.anything() },
      { settlementId: 'settlement-1' },
    );
  });

  it('produces independent settlements for a merchant with both USD and EUR configs', async () => {
    const usdConfig: MerchantSettlementConfig = {
      id: 'config-usd',
      userId: merchantId,
      schedule: SettlementSchedule.DAILY,
      currency: 'USD',
      settlementAsset: null,
      maxSlippagePercent: 0.5,
      destinationId: 'destination-1',
      reservePercent: 0,
      reserveDays: 0,
      totalReservedAmount: 0,
      lastSettledAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const eurConfig: MerchantSettlementConfig = {
      ...usdConfig,
      id: 'config-eur',
      currency: 'EUR',
      destinationId: 'destination-eur',
    };

    const usdPayments = [
      {
        id: 'payment-usd-1',
        amount: 100,
        netAmount: 95,
        status: PaymentStatus.COMPLETED,
        currency: 'USD',
        merchantId,
        updatedAt: new Date(),
      },
    ] as Payment[];
    const eurPayments = [
      {
        id: 'payment-eur-1',
        amount: 80,
        netAmount: 76,
        status: PaymentStatus.COMPLETED,
        currency: 'EUR',
        merchantId,
        updatedAt: new Date(),
      },
    ] as Payment[];

    let currentCurrency: string | undefined;
    const queryBuilder = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest
        .fn()
        .mockImplementation(
          (_clause: string, params?: { currency?: string }) => {
            if (params?.currency) currentCurrency = params.currency;
            return queryBuilder;
          },
        ),
      getMany: jest
        .fn()
        .mockImplementation(async () =>
          currentCurrency === 'EUR' ? eurPayments : usdPayments,
        ),
    };

    let lockedId: string | undefined;
    const lockQueryBuilder = {
      setLock: jest.fn().mockReturnThis(),
      where: jest
        .fn()
        .mockImplementation((_clause: string, params?: { id?: string }) => {
          lockedId = params?.id;
          return lockQueryBuilder;
        }),
      getOne: jest
        .fn()
        .mockImplementation(async () =>
          lockedId === 'config-eur' ? eurConfig : usdConfig,
        ),
    };
    const manager = {
      createQueryBuilder: jest.fn((entity: unknown) =>
        entity === MerchantSettlementConfig ? lockQueryBuilder : queryBuilder,
      ),
      find: jest.fn().mockResolvedValue([]),
      create: jest.fn((_entity: unknown, payload: unknown) => payload),
      save: jest.fn(async (payload: any) => ({ id: 'settlement', ...payload })),
      update: jest.fn().mockResolvedValue(undefined),
    };
    const queryRunner = {
      manager,
      connect: jest.fn(),
      startTransaction: jest.fn(),
      commitTransaction: jest.fn(),
      rollbackTransaction: jest.fn(),
      release: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SettlementsService,
        {
          provide: getRepositoryToken(Settlement),
          useValue: {
            create: jest.fn().mockImplementation((payload) => payload),
            save: jest.fn().mockImplementation(async (payload) => ({
              ...payload,
              id: `settlement-${payload.currency}`,
            })),
            find: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(SettlementAdjustment),
          useValue: { find: jest.fn().mockResolvedValue([]) },
        },
        {
          provide: getRepositoryToken(MerchantSettlementConfig),
          useValue: {
            findOneBy: jest.fn(),
            find: jest.fn().mockResolvedValue([usdConfig, eurConfig]),
            save: jest.fn().mockImplementation(async (c) => c),
          },
        },
        {
          provide: getRepositoryToken(Payment),
          useValue: {
            createQueryBuilder: jest.fn().mockReturnValue(queryBuilder),
            update: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: MailService,
          useValue: {
            sendSettlementNotification: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: UsersService,
          useValue: {
            findOne: jest
              .fn()
              .mockResolvedValue({
                email: 'merchant@test.com',
                status: 'ACTIVE',
              }),
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn(
              (_key: string, defaultValue?: unknown) => defaultValue,
            ),
          },
        },
        {
          provide: getRepositoryToken(PayoutDestination),
          useValue: {
            findOneBy: jest
              .fn()
              .mockImplementation(async ({ id }: { id: string }) => ({
                id,
                assetCode: id === 'destination-eur' ? 'EUR' : 'USD',
                stellarAddress: 'GABC',
                verifiedAt: new Date(),
                coolingOffUntil: null,
              })),
            find: jest.fn().mockResolvedValue([]),
          },
        },
        {
          provide: getRepositoryToken(Refund),
          useValue: { find: jest.fn().mockResolvedValue([]) },
        },
        {
          provide: DataSource,
          useValue: {
            createQueryRunner: jest.fn().mockReturnValue(queryRunner),
          },
        },
        {
          provide: WebhooksService,
          useValue: { dispatchEventToMerchant: jest.fn() },
        },
        { provide: EventsService, useValue: { emit: jest.fn() } },
        { provide: AuthService, useValue: { validateStepUpToken: jest.fn() } },
        {
          provide: StellarService,
          useValue: {
            validatePayoutDestination: jest.fn(),
            convertAsset: jest.fn(),
          },
        },
        { provide: AuditLogsService, useValue: { record: jest.fn() } },
        {
          provide: StellarHorizonClientService,
          useValue: { getPathQuote: jest.fn() },
        },
      ],
    }).compile();

    const multiCurrencyService =
      module.get<SettlementsService>(SettlementsService);

    const result = await multiCurrencyService.triggerManualRun();

    expect(result.settlementsCreated).toBe(2);
    const currencies = result.settlements.map((s) => s.currency).sort();
    expect(currencies).toEqual(['EUR', 'USD']);
  });
});

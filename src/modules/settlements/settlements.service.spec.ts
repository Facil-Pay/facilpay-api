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
import { MailService } from '../auth/mail/mail.service';
import { UsersService } from '../users/users.service';

describe('SettlementsService', () => {
  let service: SettlementsService;
  let settlementRepo: Repository<Settlement>;
  let paymentRepo: Repository<Payment>;
  let configRepo: Repository<MerchantSettlementConfig>;

  const merchantId = 'merchant-1';
  const config: MerchantSettlementConfig = {
    id: 'config-1',
    userId: merchantId,
    schedule: SettlementSchedule.DAILY,
    currency: 'USD',
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
          provide: MailService,
          useValue: {
            sendSettlementNotification: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: UsersService,
          useValue: {
            findOne: jest.fn().mockResolvedValue({ email: 'merchant@test.com' }),
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
    expect(settlementRepo.create).toHaveBeenCalledWith(
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
    expect(settlementRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        totalAmount: 150,
      }),
    );
  });

  it('filters completed payments by merchantId when settling', async () => {
    await buildModule(false);

    await service.triggerManualRun();

    const createQueryBuilder = paymentRepo.createQueryBuilder as jest.Mock;
    const queryBuilder = createQueryBuilder.mock.results[0].value;
    expect(queryBuilder.andWhere).toHaveBeenCalledWith(
      'p.merchantId = :merchantId',
      { merchantId: config.userId },
    );
  });

  it('updates config and payment settlement linkage after settlement', async () => {
    await buildModule(false);

    await service.triggerManualRun();

    expect(configRepo.save).toHaveBeenCalled();
    expect(paymentRepo.update).toHaveBeenCalledWith(
      { id: expect.anything() },
      { settlementId: 'settlement-1' },
    );
  });
});

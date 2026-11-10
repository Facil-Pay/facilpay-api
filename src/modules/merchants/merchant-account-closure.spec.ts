jest.mock('../../tracing', () => ({
  getTraceId: jest.fn(),
  initializeTracing: jest.fn(),
  runWithTrace: (_name: string, fn: () => unknown) => fn(),
}));

import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConflictException } from '@nestjs/common';
import { MerchantsService } from './merchants.service';
import { MerchantGeoRestriction } from './entities/merchant-geo-restriction.entity';
import { MerchantIpAllowlist } from './entities/merchant-ip-allowlist.entity';
import { MerchantSettings } from './entities/merchant-settings.entity';
import {
  MerchantOnboarding,
  OnboardingStatus,
} from '../onboarding/merchant-onboarding.entity';
import { GeoLookupService } from './geo-lookup.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { Dispute } from '../payments/dispute.entity';
import { Payout, PayoutStatus } from '../payouts/entities/payout.entity';
import { Payment } from '../payments/payment.entity';
import { ApiKey } from '../api-keys/api-key.entity';
import { WebhookEndpoint } from '../webhooks/entities/webhook-endpoint.entity';
import { PaymentLink } from '../payment-links/payment-link.entity';

describe('MerchantsService — Account Closure Flow (#550)', () => {
  let service: MerchantsService;
  let onboardingRepo: {
    findOneBy: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
  };
  let disputeRepo: { count: jest.Mock };
  let payoutRepo: { count: jest.Mock; find: jest.Mock };
  let paymentRepo: { find: jest.Mock };
  let apiKeyRepo: { update: jest.Mock };
  let webhookRepo: { update: jest.Mock };
  let paymentLinkRepo: { update: jest.Mock };
  let auditLogsService: { record: jest.Mock };

  beforeEach(async () => {
    onboardingRepo = {
      findOneBy: jest.fn().mockResolvedValue({
        merchantId: 'm-1',
        status: OnboardingStatus.APPROVED,
      }),
      create: jest.fn((data) => ({ ...data })),
      save: jest.fn(async (data) => data),
    };
    disputeRepo = { count: jest.fn().mockResolvedValue(0) };
    payoutRepo = {
      count: jest.fn().mockResolvedValue(0),
      find: jest.fn().mockResolvedValue([]),
    };
    paymentRepo = { find: jest.fn().mockResolvedValue([]) };
    apiKeyRepo = { update: jest.fn().mockResolvedValue({ affected: 2 }) };
    webhookRepo = { update: jest.fn().mockResolvedValue({ affected: 1 }) };
    paymentLinkRepo = { update: jest.fn().mockResolvedValue({ affected: 3 }) };
    auditLogsService = { record: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MerchantsService,
        { provide: getRepositoryToken(MerchantGeoRestriction), useValue: {} },
        { provide: getRepositoryToken(MerchantIpAllowlist), useValue: {} },
        { provide: getRepositoryToken(MerchantSettings), useValue: {} },
        {
          provide: getRepositoryToken(MerchantOnboarding),
          useValue: onboardingRepo,
        },
        { provide: GeoLookupService, useValue: {} },
        { provide: AuditLogsService, useValue: auditLogsService },
        { provide: getRepositoryToken(Dispute), useValue: disputeRepo },
        { provide: getRepositoryToken(Payout), useValue: payoutRepo },
        { provide: getRepositoryToken(Payment), useValue: paymentRepo },
        { provide: getRepositoryToken(ApiKey), useValue: apiKeyRepo },
        { provide: getRepositoryToken(WebhookEndpoint), useValue: webhookRepo },
        {
          provide: getRepositoryToken(PaymentLink),
          useValue: paymentLinkRepo,
        },
      ],
    }).compile();

    service = module.get(MerchantsService);
  });

  it('blocks closure and returns clear list of obligations when open disputes, pending payouts, or balance remain', async () => {
    disputeRepo.count.mockResolvedValue(2);
    payoutRepo.count.mockResolvedValue(1);
    paymentRepo.find.mockResolvedValue([{ amount: '150.00', refundedAmount: '0' }]);
    payoutRepo.find.mockResolvedValue([
      { amount: '50.00', status: PayoutStatus.COMPLETED },
    ]);

    try {
      await service.closeAccount('m-1', 'm-1');
      fail('Expected ConflictException');
    } catch (err) {
      expect(err).toBeInstanceOf(ConflictException);
      const response = (err as ConflictException).getResponse() as any;
      expect(response.obligations).toEqual([
        '2 open dispute(s) must be resolved before closing the account',
        '1 pending payout(s) must settle before closing the account',
        'Unsettled balance of 100.00 must be withdrawn before closing the account',
      ]);
      expect(response.details).toEqual({
        openDisputes: 2,
        pendingPayouts: 1,
        unsettledBalance: 100,
      });
    }

    expect(apiKeyRepo.update).not.toHaveBeenCalled();
    expect(auditLogsService.record).not.toHaveBeenCalled();
  });

  it('closes account, deactivates API keys/webhooks/payment links, retains financial records, and logs audit event when all obligations are settled', async () => {
    disputeRepo.count.mockResolvedValue(0);
    payoutRepo.count.mockResolvedValue(0);
    paymentRepo.find.mockResolvedValue([{ amount: '200.00', refundedAmount: '0' }]);
    payoutRepo.find.mockResolvedValue([
      { amount: '200.00', status: PayoutStatus.COMPLETED },
    ]);

    const result = await service.closeAccount('m-1', 'm-1');

    expect(result.status).toBe(OnboardingStatus.CLOSED);
    expect(result.closedAt).toBeInstanceOf(Date);
    expect(result.deactivated).toEqual({
      apiKeys: 2,
      webhooks: 1,
      paymentLinks: 3,
    });
    expect(result.financialRecordsRetained).toBe(true);

    expect(apiKeyRepo.update).toHaveBeenCalledWith(
      { userId: 'm-1', isActive: true },
      { isActive: false },
    );
    expect(webhookRepo.update).toHaveBeenCalledWith(
      { merchantId: 'm-1', isActive: true },
      { isActive: false, disabledReason: 'account_closed' },
    );
    expect(paymentLinkRepo.update).toHaveBeenCalledWith(
      { merchantId: 'm-1', isActive: true },
      { isActive: false },
    );
    expect(auditLogsService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'm-1',
        action: 'merchant_account_closed',
        resourceType: 'merchant_account',
        resourceId: 'm-1',
      }),
    );
  });

  it('throws ConflictException if merchant account is already closed', async () => {
    onboardingRepo.findOneBy.mockResolvedValue({
      merchantId: 'm-1',
      status: OnboardingStatus.CLOSED,
    });

    await expect(service.closeAccount('m-1')).rejects.toThrow(
      'Merchant account is already closed',
    );
  });
});

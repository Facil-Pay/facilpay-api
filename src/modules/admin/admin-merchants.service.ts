import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { Dispute } from '../payments/dispute.entity';
import { Payment, PaymentStatus } from '../payments/payment.entity';
import { Refund } from '../payments/refund.entity';
import {
  MerchantOnboarding,
  OnboardingStatus,
} from '../onboarding/merchant-onboarding.entity';
import { Session } from '../auth/entities/session.entity';
import { User } from '../users/user.entity';
import { UserRole } from '../../common/constants/roles';
import { ListAdminMerchantsDto } from './dto/list-admin-merchants.dto';

interface MerchantActivityMetrics {
  volume30d: Record<string, string>;
  refundRate30d: number;
  disputeRate30d: number;
  lastActivityAt: Date | null;
}

const SUCCESSFUL_STATUSES = [
  PaymentStatus.COMPLETED,
  PaymentStatus.PARTIALLY_REFUNDED,
  PaymentStatus.REFUNDED,
];

@Injectable()
export class AdminMerchantsService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(MerchantOnboarding)
    private readonly onboardingRepository: Repository<MerchantOnboarding>,
    @InjectRepository(Payment)
    private readonly paymentRepository: Repository<Payment>,
    @InjectRepository(Refund)
    private readonly refundRepository: Repository<Refund>,
    @InjectRepository(Dispute)
    private readonly disputeRepository: Repository<Dispute>,
    @InjectRepository(Session)
    private readonly sessionRepository: Repository<Session>,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  async list(dto: ListAdminMerchantsDto) {
    const query = this.userRepository
      .createQueryBuilder('merchant')
      .leftJoin(
        MerchantOnboarding,
        'onboarding',
        'onboarding.merchantId = merchant.id',
      )
      .select('merchant.id', 'id')
      .addSelect('merchant.email', 'email')
      .addSelect('merchant.isActive', 'isActive')
      .addSelect('merchant.createdAt', 'createdAt')
      .addSelect('onboarding.businessName', 'businessName')
      .addSelect('onboarding.status', 'onboardingStatus')
      .where('merchant.deletedAt IS NULL')
      .andWhere("'USER' = ANY(merchant.roles)");

    if (dto.search?.trim()) {
      query.andWhere(
        '(merchant.email ILIKE :search OR onboarding.businessName ILIKE :search)',
        { search: `%${dto.search.trim()}%` },
      );
    }
    if (dto.status) {
      query.andWhere('merchant.isActive = :isActive', {
        isActive: dto.status === 'active',
      });
    }
    if (dto.onboardingStatus) {
      query.andWhere(
        '(onboarding.status = :onboardingStatus OR (onboarding.merchantId IS NULL AND :onboardingStatus = :pendingStatus))',
        {
          onboardingStatus: dto.onboardingStatus,
          pendingStatus: OnboardingStatus.PENDING,
        },
      );
    }

    const page = dto.page ?? 1;
    const limit = dto.limit ?? 25;
    query
      .orderBy('merchant.createdAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    const [rows, total] = await Promise.all([
      query.getRawMany<{
        id: string;
        email: string;
        isActive: boolean;
        createdAt: Date;
        businessName: string | null;
        onboardingStatus: string | null;
      }>(),
      query.getCount(),
    ]);
    const metrics = await this.getMetrics(rows.map((merchant) => merchant.id));

    return {
      data: rows.map((merchant) => ({
        id: merchant.id,
        businessName: merchant.businessName,
        email: merchant.email,
        createdAt: merchant.createdAt,
        status: merchant.isActive ? 'active' : 'inactive',
        onboardingStatus:
          merchant.onboardingStatus ?? OnboardingStatus.PENDING,
        ...metrics.get(merchant.id),
      })),
      total,
      page,
      limit,
    };
  }

  async getById(
    merchantId: string,
    actor: { id: string; ipAddress?: string; userAgent?: string },
  ) {
    const merchant = await this.userRepository.findOne({
      where: { id: merchantId, deletedAt: IsNull() },
      select: ['id', 'email', 'isActive', 'createdAt', 'roles'],
    });
    if (!merchant || !merchant.roles.includes(UserRole.USER)) {
      throw new NotFoundException('Merchant not found');
    }

    const onboarding = await this.onboardingRepository.findOneBy({
      merchantId,
    });
    const metrics = (await this.getMetrics([merchantId])).get(merchantId);

    await this.auditLogsService.record({
      actorId: actor.id,
      actorType: 'user',
      action: 'admin.merchant.viewed',
      resourceType: 'merchant',
      resourceId: merchantId,
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });

    return {
      id: merchant.id,
      businessName: onboarding?.businessName ?? null,
      email: merchant.email,
      createdAt: merchant.createdAt,
      status: merchant.isActive ? 'active' : 'inactive',
      onboardingStatus: onboarding?.status ?? OnboardingStatus.PENDING,
      ...metrics,
    };
  }

  private async getMetrics(
    merchantIds: string[],
  ): Promise<Map<string, MerchantActivityMetrics>> {
    const metrics = new Map<string, MerchantActivityMetrics>();
    if (merchantIds.length === 0) return metrics;

    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const [volumes, refunded, disputed, activity] = await Promise.all([
      this.paymentRepository
        .createQueryBuilder('payment')
        .select('payment.merchantId', 'merchantId')
        .addSelect('payment.currency', 'currency')
        .addSelect('SUM(payment.amount)', 'volume')
        .addSelect('COUNT(payment.id)', 'transactionCount')
        .where('payment.merchantId IN (:...merchantIds)', { merchantIds })
        .andWhere('payment.createdAt >= :since', { since })
        .andWhere('payment.status IN (:...statuses)', {
          statuses: SUCCESSFUL_STATUSES,
        })
        .groupBy('payment.merchantId')
        .addGroupBy('payment.currency')
        .getRawMany<{
          merchantId: string;
          currency: string;
          volume: string;
          transactionCount: string;
        }>(),
      this.refundRepository
        .createQueryBuilder('refund')
        .innerJoin(Payment, 'payment', 'payment.id = refund.paymentId')
        .select('payment.merchantId', 'merchantId')
        .addSelect('COUNT(DISTINCT payment.id)', 'count')
        .where('payment.merchantId IN (:...merchantIds)', { merchantIds })
        .andWhere('payment.createdAt >= :since', { since })
        .andWhere('payment.status IN (:...statuses)', {
          statuses: SUCCESSFUL_STATUSES,
        })
        .andWhere('refund.createdAt >= :since', { since })
        .groupBy('payment.merchantId')
        .getRawMany<{ merchantId: string; count: string }>(),
      this.disputeRepository
        .createQueryBuilder('dispute')
        .innerJoin(Payment, 'payment', 'payment.id = dispute.paymentId')
        .select('payment.merchantId', 'merchantId')
        .addSelect('COUNT(DISTINCT payment.id)', 'count')
        .where('payment.merchantId IN (:...merchantIds)', { merchantIds })
        .andWhere('payment.createdAt >= :since', { since })
        .andWhere('payment.status IN (:...statuses)', {
          statuses: SUCCESSFUL_STATUSES,
        })
        .andWhere('dispute.createdAt >= :since', { since })
        .groupBy('payment.merchantId')
        .getRawMany<{ merchantId: string; count: string }>(),
      this.sessionRepository
        .createQueryBuilder('session')
        .select('session.userId', 'merchantId')
        .addSelect('MAX(session.lastActiveAt)', 'lastActivityAt')
        .where('session.userId IN (:...merchantIds)', { merchantIds })
        .andWhere('session.revoked = false')
        .groupBy('session.userId')
        .getRawMany<{ merchantId: string; lastActivityAt: Date | null }>(),
    ]);

    const transactionCounts = new Map<string, number>();
    for (const volume of volumes) {
      const current = metrics.get(volume.merchantId) ?? {
        volume30d: {},
        refundRate30d: 0,
        disputeRate30d: 0,
        lastActivityAt: null,
      };
      current.volume30d[volume.currency] = volume.volume;
      metrics.set(volume.merchantId, current);
      transactionCounts.set(
        volume.merchantId,
        (transactionCounts.get(volume.merchantId) ?? 0) +
          Number(volume.transactionCount),
      );
    }

    for (const merchantId of merchantIds) {
      if (!metrics.has(merchantId)) {
        metrics.set(merchantId, {
          volume30d: {},
          refundRate30d: 0,
          disputeRate30d: 0,
          lastActivityAt: null,
        });
      }
    }

    for (const row of refunded) {
      const denominator = transactionCounts.get(row.merchantId) ?? 0;
      metrics.get(row.merchantId)!.refundRate30d = denominator
        ? (Number(row.count) / denominator) * 100
        : 0;
    }
    for (const row of disputed) {
      const denominator = transactionCounts.get(row.merchantId) ?? 0;
      metrics.get(row.merchantId)!.disputeRate30d = denominator
        ? (Number(row.count) / denominator) * 100
        : 0;
    }
    for (const row of activity) {
      const value = metrics.get(row.merchantId);
      if (value) value.lastActivityAt = row.lastActivityAt;
    }

    return metrics;
  }
}
import { Repository } from 'typeorm';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { Dispute } from '../payments/dispute.entity';
import { Payment } from '../payments/payment.entity';
import { Refund } from '../payments/refund.entity';
import { MerchantOnboarding } from '../onboarding/merchant-onboarding.entity';
import { Session } from '../auth/entities/session.entity';
import { User } from '../users/user.entity';
import { ListAdminMerchantsDto } from './dto/list-admin-merchants.dto';
import { AdminMerchantsService } from './admin-merchants.service';

interface MockQueryBuilder {
  [method: string]: jest.Mock;
  getRawMany: jest.Mock;
  getCount: jest.Mock;
}

function createQueryBuilder(
  rawRows: unknown[] = [],
  count = 0,
): MockQueryBuilder {
  const builder: MockQueryBuilder = {
    select: jest.fn(),
    addSelect: jest.fn(),
    leftJoin: jest.fn(),
    innerJoin: jest.fn(),
    where: jest.fn(),
    andWhere: jest.fn(),
    groupBy: jest.fn(),
    addGroupBy: jest.fn(),
    orderBy: jest.fn(),
    skip: jest.fn(),
    take: jest.fn(),
    getRawMany: jest.fn().mockResolvedValue(rawRows),
    getCount: jest.fn().mockResolvedValue(count),
  };
  for (const method of [
    'select',
    'addSelect',
    'leftJoin',
    'innerJoin',
    'where',
    'andWhere',
    'groupBy',
    'addGroupBy',
    'orderBy',
    'skip',
    'take',
  ]) {
    builder[method].mockReturnValue(builder);
  }
  return builder;
}

describe('AdminMerchantsService', () => {
  let service: AdminMerchantsService;
  let userRepository: Partial<Repository<User>>;
  let onboardingRepository: Partial<Repository<MerchantOnboarding>>;
  let paymentRepository: Partial<Repository<Payment>>;
  let refundRepository: Partial<Repository<Refund>>;
  let disputeRepository: Partial<Repository<Dispute>>;
  let sessionRepository: Partial<Repository<Session>>;
  let auditLogsService: Partial<AuditLogsService>;
  let listQuery: ReturnType<typeof createQueryBuilder>;

  beforeEach(() => {
    listQuery = createQueryBuilder(
      [
        {
          id: 'merchant-1',
          email: 'owner@example.com',
          isActive: true,
          createdAt: new Date('2026-01-01T00:00:00Z'),
          businessName: 'Example Shop',
          onboardingStatus: 'approved',
        },
      ],
      1,
    );
    userRepository = {
      createQueryBuilder: jest.fn().mockReturnValue(listQuery),
    };
    onboardingRepository = {};
    paymentRepository = {
      createQueryBuilder: jest.fn().mockReturnValue(
        createQueryBuilder([
          {
            merchantId: 'merchant-1',
            currency: 'USD',
            volume: '300.00',
            transactionCount: '2',
          },
        ]),
      ),
    };
    refundRepository = {
      createQueryBuilder: jest
        .fn()
        .mockReturnValue(
          createQueryBuilder([{ merchantId: 'merchant-1', count: '1' }]),
        ),
    };
    disputeRepository = {
      createQueryBuilder: jest
        .fn()
        .mockReturnValue(
          createQueryBuilder([{ merchantId: 'merchant-1', count: '2' }]),
        ),
    };
    sessionRepository = {
      createQueryBuilder: jest.fn().mockReturnValue(
        createQueryBuilder([
          {
            merchantId: 'merchant-1',
            lastActivityAt: new Date('2026-02-01T00:00:00Z'),
          },
        ]),
      ),
    };
    auditLogsService = { record: jest.fn() };
    service = new AdminMerchantsService(
      userRepository as Repository<User>,
      onboardingRepository as Repository<MerchantOnboarding>,
      paymentRepository as Repository<Payment>,
      refundRepository as Repository<Refund>,
      disputeRepository as Repository<Dispute>,
      sessionRepository as Repository<Session>,
      auditLogsService as AuditLogsService,
    );
  });

  it('filters by search, account status, and onboarding status', async () => {
    const query: ListAdminMerchantsDto = {
      search: '  example  ',
      status: 'active',
      onboardingStatus: 'approved' as ListAdminMerchantsDto['onboardingStatus'],
      page: 2,
      limit: 10,
    };

    const result = await service.list(query);

    expect(listQuery.andWhere).toHaveBeenCalledWith(
      '(merchant.email ILIKE :search OR onboarding.businessName ILIKE :search)',
      { search: '%example%' },
    );
    expect(listQuery.andWhere).toHaveBeenCalledWith(
      'merchant.isActive = :isActive',
      { isActive: true },
    );
    expect(listQuery.andWhere).toHaveBeenCalledWith(
      '(onboarding.status = :onboardingStatus OR (onboarding.merchantId IS NULL AND :onboardingStatus = :pendingStatus))',
      { onboardingStatus: 'approved', pendingStatus: 'pending' },
    );
    expect(listQuery.skip).toHaveBeenCalledWith(10);
    expect(result).toMatchObject({ total: 1, page: 2, limit: 10 });
    expect(result.data[0]).toMatchObject({
      businessName: 'Example Shop',
      volume30d: { USD: '300.00' },
      refundRate30d: 50,
      disputeRate30d: 100,
    });
  });

  it('treats a merchant without an onboarding row as pending', async () => {
    listQuery.getRawMany.mockResolvedValue([
      {
        id: 'merchant-1',
        email: 'owner@example.com',
        isActive: true,
        createdAt: new Date('2026-01-01T00:00:00Z'),
        businessName: null,
        onboardingStatus: null,
      },
    ]);

    const result = await service.list({ page: 1, limit: 25 });

    expect(result.data[0].onboardingStatus).toBe('pending');
  });
});

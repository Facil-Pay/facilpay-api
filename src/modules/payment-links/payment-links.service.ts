import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  GoneException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { randomBytes } from 'crypto';
import { createHash, randomBytes } from 'crypto';
import { PaymentLink, RESERVED_SLUGS, CustomField } from './payment-link.entity';
import { PaymentLinkEvent, PaymentLinkEventType } from './entities/payment-link-event.entity';
import { GetAnalyticsDto, AnalyticsBucketDto } from './dto/get-analytics.dto';
import { CouponsService, calculateCouponDiscount } from '../coupons/coupons.service';
import { CreatePaymentLinkDto } from './dto/create-payment-link.dto';
import { UpdatePaymentLinkDto } from './dto/update-payment-link.dto';
import { RedeemPaymentLinkDto } from './dto/redeem-payment-link.dto';
import {
  BULK_DEACTIVATE_MAX_IDS,
  BulkDeactivateResponse,
  BulkDeactivateResult,
} from './dto/bulk-deactivate-payment-links.dto';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { PaginatedResult } from '../../common/interfaces/paginated-result.interface';
import { AppLogger } from '../logger/logger.service';
import type { Logger } from 'pino';
import { UsersService } from '../users/users.service';

@Injectable()
export class PaymentLinksService {
  private readonly logger: Logger;
  private readonly viewDebounceWindowMs = 60 * 60 * 1000; // 1 hour

  constructor(
    @InjectRepository(PaymentLink)
    private readonly repo: Repository<PaymentLink>,
    @InjectRepository(PaymentLinkEvent)
    private readonly eventRepo: Repository<PaymentLinkEvent>,
    private readonly couponsService: CouponsService,
    appLogger: AppLogger,
    private readonly usersService: UsersService,
  ) {
    this.logger = appLogger.child({ module: PaymentLinksService.name });
  }

  /**
   * Validates that a slug is valid format and not reserved
   */
  private validateSlug(slug: string): void {
    if (!/^[a-z0-9-]{3,64}$/.test(slug)) {
      throw new BadRequestException(
        'Slug must be 3-64 characters, lowercase letters, numbers, and hyphens only',
      );
    }
    if (RESERVED_SLUGS.has(slug)) {
      throw new BadRequestException(`Slug '${slug}' is reserved and cannot be used`);
    }
  }

  /**
   * Validates required fields and custom fields during redemption
   */
  private validatePayerFields(
    link: PaymentLink,
    dto: RedeemPaymentLinkDto,
  ): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Check required fields
    if (link.requiredFields?.name && !dto.name) {
      errors.push('name is required');
    }
    if (link.requiredFields?.email && !dto.email) {
      errors.push('email is required');
    }
    if (link.requiredFields?.phone && !dto.phone) {
      errors.push('phone is required');
    }

    // Check custom fields
    if (link.customFields && link.customFields.length > 0) {
      const providedKeys = new Set(dto.customFields?.map((f) => f.key) || []);
      for (const field of link.customFields) {
        if (field.required && !providedKeys.has(field.key)) {
          errors.push(`${field.key} is required`);
        }
      }

      // Validate custom field values
      for (const provided of dto.customFields || []) {
        const fieldDef = link.customFields.find((f) => f.key === provided.key);
        if (!fieldDef) {
          errors.push(`unknown field: ${provided.key}`);
          continue;
        }
        if (fieldDef.type === 'number' && isNaN(Number(provided.value))) {
          errors.push(`${provided.key} must be a number`);
        }
        if (fieldDef.type === 'select' && fieldDef.options && !fieldDef.options.includes(provided.value)) {
          errors.push(`${provided.key} must be one of: ${fieldDef.options.join(', ')}`);
        }
      }
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * Extracts payer field values to store on the payment
   */
  extractPayerData(dto: RedeemPaymentLinkDto): {
    payerName?: string;
    payerEmail?: string;
    payerPhone?: string;
    metadata?: Record<string, string>;
  } {
    const metadata: Record<string, string> = {};

    for (const field of dto.customFields || []) {
      metadata[field.key] = field.value;
    }

    return {
      payerName: dto.name,
      payerEmail: dto.email,
      payerPhone: dto.phone,
      metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
    };
  }

  async create(dto: CreatePaymentLinkDto, merchantId: string): Promise<PaymentLink> {
    await this.usersService.assertMerchantActive(merchantId);
    if (!dto.flexibleAmount && (dto.amount === undefined || dto.amount === null)) {
      throw new BadRequestException('amount is required when flexibleAmount is not true');
    }

    // Validate slug if provided
    if (dto.slug) {
      this.validateSlug(dto.slug);

      // Check for slug conflicts
      const existing = await this.repo.findOneBy({ slug: dto.slug });
      if (existing) {
        throw new ConflictException(`Slug '${dto.slug}' is already in use`);
      }
    }

    const token = randomBytes(16).toString('hex');
    const link = this.repo.create({
      amount: dto.flexibleAmount ? null : dto.amount,
      flexibleAmount: dto.flexibleAmount ?? false,
      minAmount: dto.minAmount ?? null,
      currency: dto.currency,
      description: dto.description ?? null,
      expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
      token,
      slug: dto.slug ?? null,
      merchantId,
      requiredFields: dto.requiredFields
        ? { name: dto.requiredFields.name ?? false, email: dto.requiredFields.email ?? false, phone: dto.requiredFields.phone ?? false }
        : { name: false, email: false, phone: false },
      customFields: dto.customFields ?? [],
      successUrl: dto.successUrl ?? null,
      cancelUrl: dto.cancelUrl ?? null,
      maxCompletions: dto.maxCompletions ?? null,
    });
    return this.repo.save(link);
  }

  async duplicate(
    id: string,
    merchantId: string,
    overrides: Partial<CreatePaymentLinkDto> = {},
  ): Promise<PaymentLink> {
    const source = await this.repo.findOneBy({ id });
    if (!source) throw new NotFoundException('Payment link not found');
    if (source.merchantId !== merchantId) throw new ForbiddenException();

    const configuration: CreatePaymentLinkDto = {
      amount: source.amount === null ? undefined : Number(source.amount),
      flexibleAmount: source.flexibleAmount,
      minAmount: source.minAmount === null ? undefined : Number(source.minAmount),
      currency: source.currency,
      description: source.description ?? undefined,
      expiresAt: source.expiresAt?.toISOString(),
      maxCompletions: source.maxCompletions ?? undefined,
      requiredFields: source.requiredFields,
      customFields: source.customFields,
      successUrl: source.successUrl ?? undefined,
      cancelUrl: source.cancelUrl ?? undefined,
      ...overrides,
      slug: overrides.slug,
    };

    return this.create(configuration, merchantId);
  }

  /**
   * Find payment link by token or slug
   */
  async findByTokenOrSlug(tokenOrSlug: string): Promise<PaymentLink> {
    let link = await this.repo.findOneBy({ token: tokenOrSlug });
    if (!link) {
      link = await this.repo.findOneBy({ slug: tokenOrSlug });
    }
    if (!link) throw new NotFoundException('Payment link not found');
    if (!link.isActive) throw new GoneException('Payment link has been deactivated');
    if (link.expiresAt && link.expiresAt < new Date()) {
      throw new GoneException('Payment link has expired');
    }
    await this.repo.increment({ id: link.id }, 'views', 1);
    link.views += 1;
    return link;
  }

  // Keep old method name for backwards compatibility
  async findByToken(token: string): Promise<PaymentLink> {
    return this.findByTokenOrSlug(token);
  }

  async redeemLink(
    tokenOrSlug: string,
    dto: RedeemPaymentLinkDto,
  ): Promise<PaymentLink & { couponPreview?: { couponId: string; discountAmount: number; amountDue: number } }> {
    const link = await this.findByTokenOrSlug(tokenOrSlug);
    await this.usersService.assertMerchantActive(link.merchantId);

    // Handle flexible amount
    if (link.flexibleAmount) {
      if (dto.payerAmount === undefined || dto.payerAmount === null) {
        throw new BadRequestException('payerAmount is required for flexible-amount payment links');
      }
      if (link.minAmount !== null && dto.payerAmount < Number(link.minAmount)) {
        throw new BadRequestException(`payerAmount must be at least ${link.minAmount}`);
      }
    }

    await this.merchantLimitsService.enforce(
      link.merchantId,
      link.currency,
      Number(link.flexibleAmount ? dto.payerAmount : link.amount),
    );

    // Validate required/custom fields
    const { valid, errors } = this.validatePayerFields(link, dto);
    if (!valid) {
      throw new BadRequestException(errors.join('; '));
    }

    if (!dto.couponCode) return link;

    const baseAmount = link.flexibleAmount ? Number(dto.payerAmount) : Number(link.amount);
    const coupon = await this.couponsService.validateForLink(
      link.merchantId,
      dto.couponCode,
      link.id,
      link.currency,
    );
    const discountAmount = calculateCouponDiscount(baseAmount, coupon);
    return Object.assign(link, {
      couponPreview: {
        couponId: coupon.id,
        discountAmount,
        amountDue: Number((baseAmount - discountAmount).toFixed(2)),
      },
    });
  }

  async incrementCompletions(id: string): Promise<void> {
    await this.repo
      .createQueryBuilder()
      .update(PaymentLink)
      .set({
        completions: () => '"completions" + 1',
        isActive: () =>
          'CASE WHEN "maxCompletions" IS NOT NULL AND "completions" + 1 >= "maxCompletions" THEN false ELSE "isActive" END',
      })
      .where('id = :id', { id })
      .execute();
  }

  async deactivate(id: string, merchantId: string): Promise<void> {
    const link = await this.repo.findOneBy({ id });
    if (!link) throw new NotFoundException('Payment link not found');
    if (link.merchantId !== merchantId) throw new ForbiddenException();
    link.isActive = false;
    await this.repo.save(link);
  }

  /**
   * Deactivates many links at once. Ids that don't exist or belong to another
   * merchant are reported as skipped (without revealing which) and left untouched.
   */
  async bulkDeactivate(ids: string[], merchantId: string): Promise<BulkDeactivateResponse> {
    const uniqueIds = [...new Set(ids)];
    if (uniqueIds.length > BULK_DEACTIVATE_MAX_IDS) {
      throw new BadRequestException(`A maximum of ${BULK_DEACTIVATE_MAX_IDS} ids can be deactivated at once`);
    }

    const owned = uniqueIds.length
      ? await this.repo.find({ where: { id: In(uniqueIds), merchantId } })
      : [];
    const ownedById = new Map(owned.map((link) => [link.id, link]));

    const toDeactivate = owned.filter((link) => link.isActive).map((link) => link.id);
    if (toDeactivate.length) {
      await this.repo.update({ id: In(toDeactivate), merchantId }, { isActive: false });
    }

    const results: BulkDeactivateResult[] = uniqueIds.map((id) => {
      const link = ownedById.get(id);
      if (!link) return { id, status: 'skipped', reason: 'Payment link not found' };
      return { id, status: link.isActive ? 'deactivated' : 'already_inactive' };
    });

    this.logger.info?.(
      { merchantId, requested: uniqueIds.length, deactivated: toDeactivate.length },
      'Bulk deactivated payment links',
    );

    return {
      results,
      deactivated: toDeactivate.length,
      skipped: results.filter((r) => r.status === 'skipped').length,
    };
  }

  async findAllByMerchant(
    merchantId: string,
    pagination: PaginationDto,
  ): Promise<PaginatedResult<PaymentLink>> {
    const page = pagination.page ?? 1;
    const limit = pagination.limit ?? 20;
    const sortBy = pagination.sortBy ?? 'createdAt';
    const order = pagination.order ?? 'DESC';

    const allowedSortFields = ['createdAt', 'amount', 'views', 'completions', 'updatedAt'];
    const sortField = allowedSortFields.includes(sortBy) ? sortBy : 'createdAt';

    const [data, total] = await this.repo.findAndCount({
      where: { merchantId },
      order: { [sortField]: order || 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    return { data, total, page, limit };
  }

  async update(
    id: string,
    merchantId: string,
    dto: UpdatePaymentLinkDto,
  ): Promise<PaymentLink> {
    const link = await this.repo.findOneBy({ id });
    if (!link) throw new NotFoundException('Payment link not found');
    if (link.merchantId !== merchantId) throw new ForbiddenException();

    if (dto.isActive === true && !link.isActive && link.expiresAt && link.expiresAt <= new Date()) {
      throw new GoneException('Expired payment links cannot be reactivated');
    }

    if (dto.isActive !== undefined) link.isActive = dto.isActive;
    if (dto.amount !== undefined) link.amount = dto.amount;
    if (dto.currency !== undefined) link.currency = dto.currency;
    if (dto.description !== undefined) link.description = dto.description ?? null;
    if (dto.successUrl !== undefined) link.successUrl = dto.successUrl ?? null;
    if (dto.cancelUrl !== undefined) link.cancelUrl = dto.cancelUrl ?? null;
    if (dto.expiresAt !== undefined) {
      link.expiresAt = dto.expiresAt ? new Date(dto.expiresAt) : null;
    }

    // Update required fields
    if (dto.requiredFields !== undefined) {
      link.requiredFields = {
        name: dto.requiredFields.name ?? false,
        email: dto.requiredFields.email ?? false,
        phone: dto.requiredFields.phone ?? false,
      };
    }

    // Update custom fields
    if (dto.customFields !== undefined) {
      link.customFields = dto.customFields as CustomField[];
    }

    return this.repo.save(link);
  }

  async getResolvedSuccessUrl(paymentLinkId: string, paymentId: string): Promise<string | null> {
    const link = await this.repo.findOneBy({ id: paymentLinkId });
    if (!link?.successUrl) return null;
    return resolvePaymentLinkSuccessUrl(link.successUrl, paymentId);
  }

  // ============ Analytics Methods ============

  /**
   * Record a view event with IP-based deduplication
   */
  async recordView(paymentLinkId: string, ip: string | undefined, userAgent?: string): Promise<void> {
    if (!ip) return;

    const ipHash = this.hashIp(ip);
    const windowStart = new Date(Date.now() - this.viewDebounceWindowMs);

    // Check for recent view from same IP
    const existingView = await this.eventRepo
      .createQueryBuilder('event')
      .where('event.paymentLinkId = :linkId', { linkId: paymentLinkId })
      .andWhere('event.type = :type', { type: PaymentLinkEventType.VIEW })
      .andWhere('event.ipHash = :ipHash', { ipHash })
      .andWhere('event.createdAt >= :windowStart', { windowStart })
      .getOne();

    if (existingView) {
      // Skip duplicate view within window
      return;
    }

    // Record the view event
    const event = this.eventRepo.create({
      paymentLinkId,
      type: PaymentLinkEventType.VIEW,
      ipHash,
      userAgent: userAgent || null,
    });
    await this.eventRepo.save(event);
  }

  /**
   * Record a redeem event
   */
  async recordRedeem(paymentLinkId: string, ip: string | undefined, userAgent?: string): Promise<void> {
    const event = this.eventRepo.create({
      paymentLinkId,
      type: PaymentLinkEventType.REDEEM,
      ipHash: ip ? this.hashIp(ip) : 'unknown',
      userAgent: userAgent || null,
    });
    await this.eventRepo.save(event);
  }

  /**
   * Record a completion event
   */
  async recordComplete(paymentLinkId: string, amount: number): Promise<void> {
    const event = this.eventRepo.create({
      paymentLinkId,
      type: PaymentLinkEventType.COMPLETE,
      ipHash: 'system',
      userAgent: null,
    });
    await this.eventRepo.save(event);

    // Also increment the counter on the payment link
    await this.incrementCompletions(paymentLinkId);
  }

  /**
   * Get analytics for a payment link
   */
  async getAnalytics(
    id: string,
    merchantId: string,
    dto: GetAnalyticsDto,
  ): Promise<{
    linkId: string;
    total: { views: number; redemptions: number; completions: number; conversionRate: number; revenue: number };
    buckets: AnalyticsBucketDto[];
  }> {
    // Verify ownership
    const link = await this.repo.findOneBy({ id });
    if (!link) throw new NotFoundException('Payment link not found');
    if (link.merchantId !== merchantId) throw new ForbiddenException();

    // Set date range defaults
    const to = dto.to ? new Date(dto.to) : new Date();
    const from = dto.from
      ? new Date(dto.from)
      : new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000); // Default 30 days

    const interval = dto.interval || 'day';

    // Build bucket query
    const bucketFormat = interval === 'week'
      ? "date_trunc('week', createdAt)"
      : "date_trunc('day', createdAt)";

    // Get event counts by bucket
    const eventCounts = await this.eventRepo
      .createQueryBuilder('event')
      .select("date_trunc('day', event.createdAt)", 'date')
      .addSelect('event.type', 'type')
      .addSelect('COUNT(*)', 'count')
      .where('event.paymentLinkId = :id', { id })
      .andWhere('event.createdAt >= :from', { from })
      .andWhere('event.createdAt <= :to', { to })
      .groupBy("date_trunc('day', event.createdAt)")
      .addGroupBy('event.type')
      .orderBy('date', 'ASC')
      .getRawMany();

    // Get total from payment link
    const totalViews = link.views;
    const totalRedemptions = eventCounts
      .filter(e => e.type === PaymentLinkEventType.REDEEM)
      .reduce((sum, e) => sum + parseInt(e.count), 0) || 0;
    const totalCompletions = link.completions;
    const conversionRate = totalViews > 0 ? totalCompletions / totalViews : 0;

    // For revenue, we use the payment link amount * completions
    const revenue = link.amount ? Number(link.amount) * 100 * totalCompletions : 0;

    // Build buckets
    const buckets = this.buildBuckets(from, to, interval, eventCounts);

    return {
      linkId: id,
      total: {
        views: totalViews,
        redemptions: totalRedemptions,
        completions: totalCompletions,
        conversionRate: Math.round(conversionRate * 100) / 100,
        revenue,
      },
      buckets,
    };
  }

  /**
   * Build analytics buckets from raw event data
   */
  private buildBuckets(
    from: Date,
    to: Date,
    interval: 'day' | 'week',
    eventCounts: Array<{ date: string; type: string; count: string }>,
  ): AnalyticsBucketDto[] {
    const buckets: AnalyticsBucketDto[] = [];
    const current = new Date(from);

    // Group events by date
    const eventsByDate = new Map<string, { VIEW: number; REDEEM: number; COMPLETE: number }>();
    for (const event of eventCounts) {
      const dateKey = event.date.split(' ')[0]; // Get just the date part
      if (!eventsByDate.has(dateKey)) {
        eventsByDate.set(dateKey, { VIEW: 0, REDEEM: 0, COMPLETE: 0 });
      }
      const counts = eventsByDate.get(dateKey)!;
      counts[event.type as keyof typeof counts] += parseInt(event.count);
    }

    while (current <= to) {
      const dateKey = current.toISOString().split('T')[0];
      const counts = eventsByDate.get(dateKey) || { VIEW: 0, REDEEM: 0, COMPLETE: 0 };

      const views = counts.VIEW;
      const redemptions = counts.REDEEM;
      const completions = counts.COMPLETE;
      const conversionRate = views > 0 ? completions / views : 0;

      buckets.push({
        date: dateKey,
        views,
        redemptions,
        completions,
        conversionRate: Math.round(conversionRate * 100) / 100,
        revenue: 0, // Per-bucket revenue requires payment data
      });

      // Advance to next interval
      if (interval === 'week') {
        current.setDate(current.getDate() + 7);
      } else {
        current.setDate(current.getDate() + 1);
      }
    }

    return buckets;
  }

  /**
   * Hash IP for deduplication
   */
  private hashIp(ip: string): string {
    return createHash('sha256').update(ip).digest('hex').substring(0, 64);
  }
}

export function resolvePaymentLinkSuccessUrl(url: string, paymentId: string): string {
  return url.replace(/\{PAYMENT_ID\}/g, encodeURIComponent(paymentId));
}

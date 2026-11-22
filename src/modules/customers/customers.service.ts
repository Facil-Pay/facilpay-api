import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  DataSource,
  EntityTarget,
  IsNull,
  ObjectLiteral,
  Repository,
} from 'typeorm';
import { Customer } from './customer.entity';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { GetCustomersDto } from './dto/get-customers.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';
import { MergeCustomerResult } from './dto/merge-customer.dto';
import { PaginatedResult } from '../../common/interfaces/paginated-result.interface';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { Payment } from '../payments/payment.entity';
import { RecurringPayment } from '../payments/recurring-payment.entity';
import { CheckoutSession } from '../checkout-sessions/entities/checkout-session.entity';
import { Invoice } from '../invoices/invoice.entity';

@Injectable()
export class CustomersService {
  constructor(
    @InjectRepository(Customer)
    private readonly customerRepository: Repository<Customer>,
    private readonly dataSource: DataSource,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  async create(merchantId: string, dto: CreateCustomerDto): Promise<Customer> {
    const customer = this.customerRepository.create({
      merchantId,
      email: this.normalizeEmail(dto.email),
      name: this.normalizeNullableString(dto.name),
      phone: this.normalizeNullableString(dto.phone),
      metadata: dto.metadata ?? null,
      tags: this.normalizeTags(dto.tags),
    });

    const saved = await this.saveWithoutDuplicateEmail(customer);
    await this.dispatchCustomerEvent('customer.created', saved);
    return saved;
  }

  async findAll(
    merchantId: string,
    dto: GetCustomersDto,
  ): Promise<PaginatedResult<Customer>> {
    const page = dto.page ?? 1;
    const limit = dto.limit ?? 20;
    const query = this.customerRepository
      .createQueryBuilder('customer')
      .where('customer.merchantId = :merchantId', { merchantId })
      .andWhere('customer.deletedAt IS NULL');

    const search = dto.search?.trim();
    if (search) {
      query.andWhere(
        '(customer.email ILIKE :search OR customer.name ILIKE :search)',
        { search: `%${search}%` },
      );
    }

    const tag = dto.tag?.trim().toLowerCase();
    if (tag) {
      // `@>` is served by the GIN index on customers.tags.
      query.andWhere('customer.tags @> ARRAY[:tag]::text[]', { tag });
    }

    const [data, total] = await query
      .orderBy('customer.createdAt', 'DESC')
      .addOrderBy('customer.id', 'DESC')
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();

    return { data, total, page, limit };
  }

  async findOne(id: string, merchantId: string): Promise<Customer> {
    const customer = await this.customerRepository.findOneBy({
      id,
      merchantId,
      deletedAt: IsNull(),
    });

    if (!customer) {
      throw new NotFoundException(`Customer with ID ${id} not found`);
    }

    return customer;
  }

  async update(
    id: string,
    merchantId: string,
    dto: UpdateCustomerDto,
  ): Promise<Customer> {
    const customer = await this.findOne(id, merchantId);

    if (dto.email !== undefined) {
      customer.email = this.normalizeEmail(dto.email);
    }
    if (dto.name !== undefined) {
      customer.name = this.normalizeNullableString(dto.name);
    }
    if (dto.phone !== undefined) {
      customer.phone = this.normalizeNullableString(dto.phone);
    }
    if (dto.metadata !== undefined) {
      customer.metadata = dto.metadata;
    }
    if (dto.tags !== undefined) {
      customer.tags = this.normalizeTags(dto.tags);
    }

    const saved = await this.saveWithoutDuplicateEmail(customer);
    await this.dispatchCustomerEvent('customer.updated', saved);
    return saved;
  }

  async remove(id: string, merchantId: string): Promise<void> {
    const customer = await this.findOne(id, merchantId);
    await this.customerRepository.softDelete(customer.id);
    await this.dispatchCustomerEvent('customer.deleted', customer);
  }

  /**
   * Folds `duplicateId` into `survivingId`: payments, recurring plans, checkout
   * sessions and invoices move to the survivor, and the duplicate is
   * soft-deleted with `mergedIntoId` pointing at it. All in one transaction.
   */
  async merge(
    survivingId: string,
    duplicateId: string,
    merchantId: string,
    actor: { id: string; ipAddress?: string; userAgent?: string },
  ): Promise<MergeCustomerResult> {
    if (survivingId === duplicateId) {
      throw new BadRequestException('A customer cannot be merged into itself');
    }

    return this.dataSource.transaction(async (manager) => {
      const customers = manager.getRepository(Customer);
      const lockCustomer = async (id: string) => {
        const customer = await customers.findOne({
          where: { id, merchantId, deletedAt: IsNull() },
          lock: { mode: 'pessimistic_write' },
        });
        if (!customer) {
          throw new NotFoundException(`Customer with ID ${id} not found`);
        }
        return customer;
      };

      // Lock in a stable order so concurrent merges of the same pair can't deadlock.
      const [firstId, secondId] = [survivingId, duplicateId].sort();
      const first = await lockCustomer(firstId);
      const second = await lockCustomer(secondId);
      const survivor = first.id === survivingId ? first : second;
      const duplicate = first.id === duplicateId ? first : second;

      const reassign = async (entity: EntityTarget<ObjectLiteral>) => {
        const result = await manager
          .createQueryBuilder()
          .update(entity)
          .set({ customerId: survivor.id })
          .where('"customerId" = :duplicateId', { duplicateId: duplicate.id })
          .andWhere('"merchantId" = :merchantId', { merchantId })
          .execute();
        return result.affected ?? 0;
      };

      const payments = await reassign(Payment);
      const recurringPayments = await reassign(RecurringPayment);
      const checkoutSessions = await reassign(CheckoutSession);

      // Invoices reference customers by email rather than id.
      const invoiceResult = await manager
        .createQueryBuilder()
        .update(Invoice)
        .set({
          customerEmail: survivor.email,
          ...(survivor.name ? { customerName: survivor.name } : {}),
        })
        .where('"merchantId" = :merchantId', { merchantId })
        .andWhere('LOWER("customerEmail") = LOWER(:email)', {
          email: duplicate.email,
        })
        .execute();
      const invoices = invoiceResult.affected ?? 0;

      duplicate.mergedIntoId = survivor.id;
      await customers.save(duplicate);
      await customers.softDelete(duplicate.id);

      const reassigned = { payments, invoices, recurringPayments, checkoutSessions };
      await this.auditLogsService.record(
        {
          actorId: actor.id,
          actorType: 'user',
          action: 'customer.merged',
          resourceType: 'customer',
          resourceId: survivor.id,
          ipAddress: actor.ipAddress,
          userAgent: actor.userAgent,
          metadata: { mergedCustomerId: duplicate.id, reassigned },
        },
        manager,
      );

      return { customer: survivor, mergedCustomerId: duplicate.id, reassigned };
    });
  }

  private normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }

  private normalizeTags(tags: string[] | undefined): string[] {
    const normalized = (tags ?? [])
      .map((tag) => tag.trim().toLowerCase())
      .filter((tag) => tag.length > 0);
    return [...new Set(normalized)];
  }

  private normalizeNullableString(
    value: string | null | undefined,
  ): string | null {
    if (value === null || value === undefined) return null;
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : null;
  }

  private async saveWithoutDuplicateEmail(
    customer: Customer,
  ): Promise<Customer> {
    try {
      return await this.customerRepository.save(customer);
    } catch (error) {
      if (this.isUniqueEmailViolation(error)) {
        throw new ConflictException(
          'A customer with this email already exists for this merchant',
        );
      }
      throw error;
    }
  }

  private isUniqueEmailViolation(error: unknown): boolean {
    if (!error || typeof error !== 'object') return false;
    const driverError = (error as { driverError?: { code?: string } })
      .driverError;
    return driverError?.code === '23505';
  }

  private async dispatchCustomerEvent(event: string, customer: Customer): Promise<void> {
    try {
      const payload = serializeCustomer(customer);
      await this.webhooksService.dispatchEventToMerchant(customer.merchantId, event, payload);
    } catch {
      // Webhook delivery failures must not break the customer operation.
    }
  }
}

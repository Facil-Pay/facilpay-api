import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { CustomersService } from './customers.service';
import { Customer } from './customer.entity';
import { Payment } from '../payments/payment.entity';
import { RecurringPayment } from '../payments/recurring-payment.entity';
import { CheckoutSession } from '../checkout-sessions/entities/checkout-session.entity';
import { Invoice } from '../invoices/invoice.entity';

describe('CustomersService.merge', () => {
  const merchantId = 'merchant-1';
  const actor = { id: merchantId, ipAddress: '10.0.0.1', userAgent: 'jest' };
  const reassigned = {
    payments: 3,
    invoices: 4,
    recurringPayments: 1,
    checkoutSessions: 2,
  };

  let customers: Map<string, Customer>;
  let customerRepo: {
    findOne: jest.Mock;
    save: jest.Mock;
    softDelete: jest.Mock;
  };
  let updates: Array<{ entity: unknown; set: any; where: any[] }>;
  let manager: { getRepository: jest.Mock; createQueryBuilder: jest.Mock };
  let dataSource: { transaction: jest.Mock };
  let auditLogsService: { record: jest.Mock };
  let service: CustomersService;

  const affectedByEntity = new Map<unknown, number>([
    [Payment, 3],
    [RecurringPayment, 1],
    [CheckoutSession, 2],
    [Invoice, 4],
  ]);

  const makeCustomer = (overrides: Partial<Customer>): Customer =>
    ({
      merchantId,
      name: null,
      phone: null,
      metadata: null,
      mergedIntoId: null,
      deletedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    }) as Customer;

  beforeEach(() => {
    customers = new Map([
      [
        'b-survivor',
        makeCustomer({ id: 'b-survivor', email: 'jane@example.com', name: 'Jane Doe' }),
      ],
      ['a-duplicate', makeCustomer({ id: 'a-duplicate', email: 'Jane@Example.com' })],
      [
        'c-foreign',
        makeCustomer({ id: 'c-foreign', email: 'x@example.com', merchantId: 'merchant-2' }),
      ],
    ]);

    customerRepo = {
      findOne: jest.fn(async ({ where }) => {
        const customer = customers.get(where.id);
        if (
          !customer ||
          customer.merchantId !== where.merchantId ||
          customer.deletedAt
        ) {
          return null;
        }
        return customer;
      }),
      save: jest.fn(async (customer) => customer),
      softDelete: jest.fn().mockResolvedValue({ affected: 1 }),
    };

    updates = [];
    manager = {
      getRepository: jest.fn().mockReturnValue(customerRepo),
      createQueryBuilder: jest.fn(() => {
        const op: { entity?: unknown; set?: any; where: any[] } = { where: [] };
        const qb: any = {
          update: jest.fn((entity) => {
            op.entity = entity;
            return qb;
          }),
          set: jest.fn((set) => {
            op.set = set;
            return qb;
          }),
          where: jest.fn((...args) => {
            op.where.push(args);
            return qb;
          }),
          andWhere: jest.fn((...args) => {
            op.where.push(args);
            return qb;
          }),
          execute: jest.fn(async () => {
            updates.push(op);
            return { affected: affectedByEntity.get(op.entity) ?? 0 };
          }),
        };
        return qb;
      }),
    };
    dataSource = { transaction: jest.fn((cb) => cb(manager)) };
    auditLogsService = { record: jest.fn().mockResolvedValue({}) };

    service = new CustomersService(
      {} as Repository<Customer>,
      dataSource as any,
      auditLogsService as any,
    );
  });

  it('reassigns related records, soft-deletes the duplicate and keeps a reference', async () => {
    const result = await service.merge('b-survivor', 'a-duplicate', merchantId, actor);

    expect(dataSource.transaction).toHaveBeenCalledTimes(1);

    for (const entity of [Payment, RecurringPayment, CheckoutSession]) {
      const op = updates.find((u) => u.entity === entity)!;
      expect(op.set).toEqual({ customerId: 'b-survivor' });
      expect(op.where).toEqual([
        ['"customerId" = :duplicateId', { duplicateId: 'a-duplicate' }],
        ['"merchantId" = :merchantId', { merchantId }],
      ]);
    }

    const invoiceOp = updates.find((u) => u.entity === Invoice)!;
    expect(invoiceOp.set).toEqual({
      customerEmail: 'jane@example.com',
      customerName: 'Jane Doe',
    });
    expect(invoiceOp.where).toEqual([
      ['"merchantId" = :merchantId', { merchantId }],
      ['LOWER("customerEmail") = LOWER(:email)', { email: 'Jane@Example.com' }],
    ]);

    expect(customerRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'a-duplicate', mergedIntoId: 'b-survivor' }),
    );
    expect(customerRepo.softDelete).toHaveBeenCalledWith('a-duplicate');

    expect(result).toEqual({
      customer: customers.get('b-survivor'),
      mergedCustomerId: 'a-duplicate',
      reassigned,
    });
  });

  it('locks both customers for the caller, in id order', async () => {
    await service.merge('b-survivor', 'a-duplicate', merchantId, actor);

    expect(customerRepo.findOne).toHaveBeenCalledTimes(2);
    for (const [args] of customerRepo.findOne.mock.calls) {
      expect(args.lock).toEqual({ mode: 'pessimistic_write' });
      expect(args.where.merchantId).toBe(merchantId);
    }
    expect(customerRepo.findOne.mock.calls.map(([args]) => args.where.id)).toEqual([
      'a-duplicate',
      'b-survivor',
    ]);
  });

  it('writes the audit log inside the same transaction', async () => {
    await service.merge('b-survivor', 'a-duplicate', merchantId, actor);

    expect(auditLogsService.record).toHaveBeenCalledWith(
      {
        actorId: merchantId,
        actorType: 'user',
        action: 'customer.merged',
        resourceType: 'customer',
        resourceId: 'b-survivor',
        ipAddress: '10.0.0.1',
        userAgent: 'jest',
        metadata: { mergedCustomerId: 'a-duplicate', reassigned },
      },
      manager,
    );
  });

  it('rejects merging a customer into itself', async () => {
    await expect(
      service.merge('b-survivor', 'b-survivor', merchantId, actor),
    ).rejects.toThrow(BadRequestException);
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });

  it('rejects when the duplicate belongs to another merchant', async () => {
    await expect(
      service.merge('b-survivor', 'c-foreign', merchantId, actor),
    ).rejects.toThrow(NotFoundException);
    expect(updates).toHaveLength(0);
    expect(customerRepo.softDelete).not.toHaveBeenCalled();
    expect(auditLogsService.record).not.toHaveBeenCalled();
  });

  it('rejects when the surviving customer belongs to another merchant', async () => {
    await expect(
      service.merge('c-foreign', 'a-duplicate', merchantId, actor),
    ).rejects.toThrow(NotFoundException);
    expect(updates).toHaveLength(0);
  });

  it('rejects when the duplicate was already deleted', async () => {
    customers.get('a-duplicate')!.deletedAt = new Date();

    await expect(
      service.merge('b-survivor', 'a-duplicate', merchantId, actor),
    ).rejects.toThrow(NotFoundException);
  });

  it('propagates failures from inside the transaction so it rolls back', async () => {
    auditLogsService.record.mockRejectedValueOnce(new Error('db down'));

    await expect(
      service.merge('b-survivor', 'a-duplicate', merchantId, actor),
    ).rejects.toThrow('db down');
  });

  it('leaves invoice customerName alone when the survivor has no name', async () => {
    customers.get('b-survivor')!.name = null;

    await service.merge('b-survivor', 'a-duplicate', merchantId, actor);

    const invoiceOp = updates.find((u) => u.entity === Invoice)!;
    expect(invoiceOp.set).toEqual({ customerEmail: 'jane@example.com' });
  });
});

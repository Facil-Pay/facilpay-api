import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Repository } from 'typeorm';
import { Customer } from './customer.entity';
import { CustomerPortalService } from './customer-portal.service';
import { Invoice } from '../invoices/invoice.entity';
import { Payment } from '../payments/payment.entity';
import { RecurringPayment } from '../payments/recurring-payment.entity';

describe('CustomerPortalService', () => {
  let service: CustomerPortalService;
  let customerRepository: { findOneBy: jest.Mock };
  let invoiceRepository: { find: jest.Mock };
  let paymentRepository: { find: jest.Mock };
  let recurringPaymentRepository: { find: jest.Mock };
  let jwtService: { signAsync: jest.Mock; verifyAsync: jest.Mock };
  let configService: { get: jest.Mock };

  beforeEach(() => {
    customerRepository = { findOneBy: jest.fn() };
    invoiceRepository = { find: jest.fn().mockResolvedValue([]) };
    paymentRepository = { find: jest.fn().mockResolvedValue([]) };
    recurringPaymentRepository = { find: jest.fn().mockResolvedValue([]) };
    jwtService = {
      signAsync: jest.fn().mockResolvedValue('signed-token'),
      verifyAsync: jest.fn(),
    };
    configService = {
      get: jest.fn((key: string, defaultValue?: string) => {
        if (key === 'APP_URL') return 'https://api.example.com';
        return defaultValue;
      }),
    };

    service = new CustomerPortalService(
      customerRepository as unknown as Repository<Customer>,
      invoiceRepository as unknown as Repository<Invoice>,
      paymentRepository as unknown as Repository<Payment>,
      recurringPaymentRepository as unknown as Repository<RecurringPayment>,
      jwtService as unknown as JwtService,
      configService as unknown as ConfigService,
    );
  });

  it('issues a one-hour URL scoped to the active customer and merchant', async () => {
    customerRepository.findOneBy.mockResolvedValue({
      id: 'customer-1',
      merchantId: 'merchant-1',
    });

    const result = await service.createSession('customer-1', 'merchant-1');

    expect(jwtService.signAsync).toHaveBeenCalledWith(
      {
        sub: 'customer-1',
        merchantId: 'merchant-1',
        purpose: 'customer-portal',
      },
      { expiresIn: 3600 },
    );
    expect(result.url).toBe(
      'https://api.example.com/v1/public/customer-portal?token=signed-token',
    );
    expect(Date.parse(result.expiresAt)).toBeGreaterThan(Date.now());
    expect(Date.parse(result.expiresAt)).toBeLessThanOrEqual(
      Date.now() + 60 * 60 * 1000,
    );
  });

  it('limits all reads to the session customer and omits internal fields', async () => {
    customerRepository.findOneBy.mockResolvedValue({
      id: 'customer-1',
      merchantId: 'merchant-1',
      email: 'jane@example.com',
      metadata: { internal: true },
    });
    jwtService.verifyAsync.mockResolvedValue({
      sub: 'customer-1',
      merchantId: 'merchant-1',
      purpose: 'customer-portal',
    });
    invoiceRepository.find.mockResolvedValue([
      {
        id: 'invoice-1',
        number: 12,
        merchantId: 'merchant-1',
        customerEmail: 'jane@example.com',
        publicToken: 'invoice-secret',
        currency: 'USD',
        subtotal: '10.00',
        taxRate: '0.00',
        taxAmount: '0.00',
        total: '10.00',
        dueDate: new Date('2026-10-30T00:00:00.000Z'),
        status: 'OPEN',
        lineItems: [
          {
            description: 'Service',
            quantity: '1.000',
            unitPrice: '10.00',
            amount: '10.00',
            productId: 'internal-product-id',
          },
        ],
      },
    ]);
    paymentRepository.find.mockResolvedValue([
      {
        id: 'payment-1',
        merchantId: 'merchant-1',
        customerId: 'customer-1',
        amount: '10.00',
        currency: 'USD',
        status: 'COMPLETED',
        description: 'Order',
        callbackUrl: 'https://internal.example.com/callback',
        metadata: { internal: true },
        createdAt: new Date('2026-10-20T00:00:00.000Z'),
      },
    ]);
    recurringPaymentRepository.find.mockResolvedValue([
      {
        id: 'plan-1',
        merchantId: 'merchant-1',
        customerId: 'customer-1',
        amount: '5.00',
        currency: 'USD',
        interval: 'monthly',
        status: 'active',
        description: 'Monthly plan',
        nextRunAt: new Date('2026-11-01T00:00:00.000Z'),
        callbackUrl: 'https://internal.example.com/callback',
        metadata: { internal: true },
      },
    ]);

    const result = await service.getPortalData('signed-token');

    expect(invoiceRepository.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ merchantId: 'merchant-1' }),
        take: 100,
      }),
    );
    expect(paymentRepository.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { merchantId: 'merchant-1', customerId: 'customer-1' },
      }),
    );
    expect(recurringPaymentRepository.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { merchantId: 'merchant-1', customerId: 'customer-1' },
      }),
    );
    expect(result.invoices[0]).not.toHaveProperty('publicToken');
    expect(result.invoices[0].lineItems[0]).not.toHaveProperty('productId');
    expect(result.payments[0]).not.toHaveProperty('callbackUrl');
    expect(result.payments[0]).not.toHaveProperty('metadata');
    expect(result.recurringPlans[0]).not.toHaveProperty('callbackUrl');
    expect(result.recurringPlans[0]).not.toHaveProperty('metadata');
  });

  it('rejects tokens with invalid claims before reading customer data', async () => {
    jwtService.verifyAsync.mockResolvedValue({
      sub: 'customer-1',
      merchantId: 'merchant-1',
      purpose: 'access-token',
    });

    await expect(service.getPortalData('wrong-purpose-token')).rejects.toThrow(
      UnauthorizedException,
    );
    expect(customerRepository.findOneBy).not.toHaveBeenCalled();
  });
});
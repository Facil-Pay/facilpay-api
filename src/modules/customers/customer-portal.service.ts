import { Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Raw, Repository } from 'typeorm';
import { Customer } from './customer.entity';
import { Invoice, InvoiceStatus } from '../invoices/invoice.entity';
import { Payment } from '../payments/payment.entity';
import { RecurringPayment } from '../payments/recurring-payment.entity';

const DEFAULT_SESSION_TTL_SECONDS = 60 * 60;
const MAX_SESSION_TTL_SECONDS = 24 * 60 * 60;
const MAX_PORTAL_RECORDS = 100;
const PORTAL_SESSION_PURPOSE = 'customer-portal';

interface CustomerPortalClaims {
  sub: string;
  merchantId: string;
  purpose: string;
}

@Injectable()
export class CustomerPortalService {
  constructor(
    @InjectRepository(Customer)
    private readonly customerRepository: Repository<Customer>,
    @InjectRepository(Invoice)
    private readonly invoiceRepository: Repository<Invoice>,
    @InjectRepository(Payment)
    private readonly paymentRepository: Repository<Payment>,
    @InjectRepository(RecurringPayment)
    private readonly recurringPaymentRepository: Repository<RecurringPayment>,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  async createSession(
    customerId: string,
    merchantId: string,
  ): Promise<{ url: string; expiresAt: string }> {
    const customer = await this.customerRepository.findOneBy({
      id: customerId,
      merchantId,
      deletedAt: IsNull(),
    });
    if (!customer) {
      throw new NotFoundException('Customer not found');
    }

    const ttlSeconds = this.getSessionTtlSeconds();
    const token = await this.jwtService.signAsync(
      { sub: customer.id, merchantId: customer.merchantId, purpose: PORTAL_SESSION_PURPOSE },
      { expiresIn: ttlSeconds },
    );
    const baseUrl = this.configService
      .get<string>('APP_URL', 'http://localhost:3000')
      .replace(/\/$/, '');

    return {
      url: `${baseUrl}/v1/public/customer-portal?token=${encodeURIComponent(token)}`,
      expiresAt: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
    };
  }

  async getPortalData(token: string): Promise<{
    invoices: unknown[];
    payments: unknown[];
    recurringPlans: unknown[];
  }> {
    const claims = await this.verifySessionToken(token);
    const customer = await this.customerRepository.findOneBy({
      id: claims.sub,
      merchantId: claims.merchantId,
      deletedAt: IsNull(),
    });
    if (!customer) {
      throw new UnauthorizedException('Invalid or expired customer portal link');
    }

    const [invoices, payments, recurringPlans] = await Promise.all([
      this.invoiceRepository.find({
        where: {
          merchantId: claims.merchantId,
          customerEmail: Raw(
            (column) => `LOWER(${column}) = LOWER(:customerEmail)`,
            { customerEmail: customer.email },
          ),
          status: In([InvoiceStatus.OPEN, InvoiceStatus.OVERDUE, InvoiceStatus.PAID]),
        },
        relations: { lineItems: true },
        order: { createdAt: 'DESC' },
        take: MAX_PORTAL_RECORDS,
      }),
      this.paymentRepository.find({
        where: { merchantId: claims.merchantId, customerId: customer.id },
        order: { createdAt: 'DESC' },
        take: MAX_PORTAL_RECORDS,
      }),
      this.recurringPaymentRepository.find({
        where: { merchantId: claims.merchantId, customerId: customer.id },
        order: { createdAt: 'DESC' },
        take: MAX_PORTAL_RECORDS,
      }),
    ]);

    return {
      invoices: invoices.map((invoice) => ({
        id: invoice.id,
        number: invoice.number,
        currency: invoice.currency,
        subtotal: invoice.subtotal,
        taxRate: invoice.taxRate,
        taxAmount: invoice.taxAmount,
        total: invoice.total,
        dueDate: invoice.dueDate,
        status: invoice.status,
        createdAt: invoice.createdAt,
        lineItems: (invoice.lineItems ?? []).map((item) => ({
          description: item.description,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          amount: item.amount,
        })),
      })),
      payments: payments.map((payment) => ({
        id: payment.id,
        amount: payment.amount,
        currency: payment.currency,
        status: payment.status,
        description: payment.description,
        createdAt: payment.createdAt,
      })),
      recurringPlans: recurringPlans.map((plan) => ({
        id: plan.id,
        amount: plan.amount,
        currency: plan.currency,
        interval: plan.interval,
        status: plan.status,
        description: plan.description,
        nextRunAt: plan.nextRunAt,
        createdAt: plan.createdAt,
      })),
    };
  }

  private async verifySessionToken(token: string): Promise<CustomerPortalClaims> {
    try {
      const claims = await this.jwtService.verifyAsync<CustomerPortalClaims>(token);
      if (
        typeof claims.sub !== 'string' ||
        typeof claims.merchantId !== 'string' ||
        claims.purpose !== PORTAL_SESSION_PURPOSE
      ) {
        throw new Error('Invalid customer portal claims');
      }
      return claims;
    } catch {
      throw new UnauthorizedException('Invalid or expired customer portal link');
    }
  }

  private getSessionTtlSeconds(): number {
    const configuredTtl = this.configService.get<string>(
      'CUSTOMER_PORTAL_SESSION_TTL_SECONDS',
    );
    const ttlSeconds = configuredTtl
      ? Number(configuredTtl)
      : DEFAULT_SESSION_TTL_SECONDS;

    if (
      !Number.isSafeInteger(ttlSeconds) ||
      ttlSeconds < 1 ||
      ttlSeconds > MAX_SESSION_TTL_SECONDS
    ) {
      throw new Error(
        'CUSTOMER_PORTAL_SESSION_TTL_SECONDS must be an integer between 1 and 86400',
      );
    }

    return ttlSeconds;
  }
}
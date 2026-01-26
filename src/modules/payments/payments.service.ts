import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Payment, PaymentStatus } from './payment.entity';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { PaymentWebhookDto } from './dto/payment-webhook.dto';

@Injectable()
export class PaymentsService {
    constructor(
        @InjectRepository(Payment)
        private readonly paymentRepository: Repository<Payment>,
    ) { }

    async create(createPaymentDto: CreatePaymentDto): Promise<Payment> {
        const payment = this.paymentRepository.create({
            ...createPaymentDto,
            status: PaymentStatus.PENDING,
        });
        return await this.paymentRepository.save(payment);
    }

    async findAll(): Promise<Payment[]> {
        return await this.paymentRepository.find({
            order: { createdAt: 'DESC' },
        });
    }

    async findOne(id: string): Promise<Payment> {
        const payment = await this.paymentRepository.findOneBy({ id });
        if (!payment) {
            throw new NotFoundException(`Payment with ID ${id} not found`);
        }
        return payment;
    }

    async handleWebhook(webhookDto: PaymentWebhookDto): Promise<Payment> {
        const payment = await this.findOne(webhookDto.paymentId);

        payment.status = webhookDto.status;
        if (webhookDto.externalReference) {
            payment.externalReference = webhookDto.externalReference;
        }

        return await this.paymentRepository.save(payment);
    }
}

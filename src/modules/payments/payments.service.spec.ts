import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PaymentsService } from './payments.service';
import { Payment, PaymentStatus } from './payment.entity';
import { NotFoundException } from '@nestjs/common';

describe('PaymentsService', () => {
    let service: PaymentsService;
    let repository: Repository<Payment>;

    const mockPayment = {
        id: 'uuid-123',
        amount: 100.5,
        currency: 'USD',
        status: PaymentStatus.PENDING,
        description: 'Test payment',
        createdAt: new Date(),
        updatedAt: new Date(),
    };

    const mockPaymentRepository = {
        create: jest.fn().mockImplementation((dto) => dto),
        save: jest.fn().mockImplementation((payment) =>
            Promise.resolve({
                id: 'uuid-123',
                ...payment,
                createdAt: new Date(),
                updatedAt: new Date(),
            }),
        ),
        find: jest.fn().mockResolvedValue([mockPayment]),
        findOneBy: jest.fn().mockResolvedValue(mockPayment),
    };

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                PaymentsService,
                {
                    provide: getRepositoryToken(Payment),
                    useValue: mockPaymentRepository,
                },
            ],
        }).compile();

        service = module.get<PaymentsService>(PaymentsService);
        repository = module.get<Repository<Payment>>(getRepositoryToken(Payment));
    });

    it('should be defined', () => {
        expect(service).toBeDefined();
    });

    describe('create', () => {
        it('should successfully create a payment', async () => {
            const dto = {
                amount: 100.5,
                currency: 'USD',
                description: 'Test payment',
            };

            const result = await service.create(dto);

            expect(repository.create).toHaveBeenCalledWith({
                ...dto,
                status: PaymentStatus.PENDING,
            });
            expect(repository.save).toHaveBeenCalled();
            expect(result.id).toEqual('uuid-123');
        });
    });

    describe('findAll', () => {
        it('should return an array of payments', async () => {
            const result = await service.findAll();
            expect(result).toEqual([mockPayment]);
            expect(repository.find).toHaveBeenCalled();
        });
    });

    describe('findOne', () => {
        it('should return a single payment', async () => {
            const result = await service.findOne('uuid-123');
            expect(result).toEqual(mockPayment);
            expect(repository.findOneBy).toHaveBeenCalledWith({ id: 'uuid-123' });
        });

        it('should throw NotFoundException if payment not found', async () => {
            jest.spyOn(repository, 'findOneBy').mockResolvedValueOnce(null);
            await expect(service.findOne('invalid-id')).rejects.toThrow(
                NotFoundException,
            );
        });
    });

    describe('handleWebhook', () => {
        it('should update payment status', async () => {
            const webhookDto = {
                paymentId: 'uuid-123',
                status: PaymentStatus.COMPLETED,
                externalReference: 'EXT-999',
            };

            const result = await service.handleWebhook(webhookDto);

            expect(result.status).toEqual(PaymentStatus.COMPLETED);
            expect(result.externalReference).toEqual('EXT-999');
            expect(repository.save).toHaveBeenCalled();
        });
    });
});

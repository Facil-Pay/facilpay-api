import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { getQueueToken } from '@nestjs/bullmq';
import { WebhooksService } from './webhooks.service';
import { WebhookEndpoint } from './entities/webhook-endpoint.entity';
import { WebhookDelivery, WebhookDeliveryStatus } from './entities/webhook-delivery.entity';
import { AppLogger } from '../logger/logger.service';
import { NotFoundException, ForbiddenException } from '@nestjs/common';

describe('WebhooksService', () => {
    let service: WebhooksService;
    let endpointRepo: any;
    let deliveryRepo: any;
    let webhooksQueue: any;
    let appLogger: any;

    beforeEach(async () => {
        endpointRepo = {
            create: jest.fn(),
            save: jest.fn(),
            find: jest.fn(),
            findOne: jest.fn(),
            findOneBy: jest.fn(),
            remove: jest.fn(),
        };

        deliveryRepo = {
            create: jest.fn(),
            save: jest.fn(),
            findOne: jest.fn(),
        };

        webhooksQueue = {
            add: jest.fn(),
        };

        appLogger = {
            child: jest.fn().mockReturnValue({
                info: jest.fn(),
                warn: jest.fn(),
                error: jest.fn(),
            }),
        };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                WebhooksService,
                { provide: getRepositoryToken(WebhookEndpoint), useValue: endpointRepo },
                { provide: getRepositoryToken(WebhookDelivery), useValue: deliveryRepo },
                { provide: getQueueToken('webhooks'), useValue: webhooksQueue },
                { provide: AppLogger, useValue: appLogger },
            ],
        }).compile();

        service = module.get<WebhooksService>(WebhooksService);
    });

    it('should be defined', () => {
        expect(service).toBeDefined();
    });

    describe('retryFailedDelivery', () => {
        it('should throw NotFoundException when delivery does not exist', async () => {
            deliveryRepo.findOne.mockResolvedValue(null);

            await expect(
                service.retryFailedDelivery('non-existent-id', 'merchant-123'),
            ).rejects.toThrow(NotFoundException);
            await expect(
                service.retryFailedDelivery('non-existent-id', 'merchant-123'),
            ).rejects.toThrow('Webhook delivery non-existent-id not found');
        });

        it('should throw ForbiddenException when delivery belongs to a different merchant', async () => {
            const endpoint = new WebhookEndpoint();
            endpoint.id = 'endpoint-1';
            endpoint.merchantId = 'merchant-123';

            const delivery = new WebhookDelivery();
            delivery.id = 'delivery-1';
            delivery.endpointId = 'endpoint-1';
            delivery.endpoint = endpoint;
            delivery.status = WebhookDeliveryStatus.FAILED;

            deliveryRepo.findOne.mockResolvedValue(delivery);

            // Attempt to retry with a different merchant ID
            await expect(
                service.retryFailedDelivery('delivery-1', 'merchant-456'),
            ).rejects.toThrow(ForbiddenException);
        });

        it('should throw ForbiddenException when delivery is not in FAILED or DEAD_LETTER status', async () => {
            const endpoint = new WebhookEndpoint();
            endpoint.id = 'endpoint-1';
            endpoint.merchantId = 'merchant-123';

            const delivery = new WebhookDelivery();
            delivery.id = 'delivery-1';
            delivery.endpointId = 'endpoint-1';
            delivery.endpoint = endpoint;
            delivery.status = WebhookDeliveryStatus.SUCCESS;

            deliveryRepo.findOne.mockResolvedValue(delivery);

            await expect(
                service.retryFailedDelivery('delivery-1', 'merchant-123'),
            ).rejects.toThrow(ForbiddenException);
            await expect(
                service.retryFailedDelivery('delivery-1', 'merchant-123'),
            ).rejects.toThrow('Only failed or dead-letter deliveries can be retried');
        });

        it('should successfully retry a FAILED delivery belonging to the authenticated merchant', async () => {
            const endpoint = new WebhookEndpoint();
            endpoint.id = 'endpoint-1';
            endpoint.merchantId = 'merchant-123';

            const delivery = new WebhookDelivery();
            delivery.id = 'delivery-1';
            delivery.endpointId = 'endpoint-1';
            delivery.endpoint = endpoint;
            delivery.status = WebhookDeliveryStatus.FAILED;
            delivery.payload = { event: 'payment.completed' };

            deliveryRepo.findOne.mockResolvedValue(delivery);
            deliveryRepo.save.mockResolvedValue(delivery);

            await service.retryFailedDelivery('delivery-1', 'merchant-123');

            expect(delivery.status).toBe(WebhookDeliveryStatus.PENDING);
            expect(deliveryRepo.save).toHaveBeenCalledWith(delivery);
            expect(webhooksQueue.add).toHaveBeenCalledWith(
                'deliver',
                {
                    deliveryId: 'delivery-1',
                    endpointId: 'endpoint-1',
                    payload: { event: 'payment.completed' },
                },
                {
                    attempts: 6,
                    backoff: {
                        type: 'exponential',
                        delay: 1000,
                    },
                    removeOnComplete: true,
                    removeOnFail: false,
                },
            );
        });

        it('should successfully retry a DEAD_LETTER delivery belonging to the authenticated merchant', async () => {
            const endpoint = new WebhookEndpoint();
            endpoint.id = 'endpoint-1';
            endpoint.merchantId = 'merchant-123';

            const delivery = new WebhookDelivery();
            delivery.id = 'delivery-1';
            delivery.endpointId = 'endpoint-1';
            delivery.endpoint = endpoint;
            delivery.status = WebhookDeliveryStatus.DEAD_LETTER;
            delivery.payload = { event: 'refund.issued' };

            deliveryRepo.findOne.mockResolvedValue(delivery);
            deliveryRepo.save.mockResolvedValue(delivery);

            await service.retryFailedDelivery('delivery-1', 'merchant-123');

            expect(delivery.status).toBe(WebhookDeliveryStatus.PENDING);
            expect(deliveryRepo.save).toHaveBeenCalledWith(delivery);
            expect(webhooksQueue.add).toHaveBeenCalled();
        });

        it('should load the endpoint relation when finding the delivery', async () => {
            const endpoint = new WebhookEndpoint();
            endpoint.id = 'endpoint-1';
            endpoint.merchantId = 'merchant-123';

            const delivery = new WebhookDelivery();
            delivery.id = 'delivery-1';
            delivery.endpointId = 'endpoint-1';
            delivery.endpoint = endpoint;
            delivery.status = WebhookDeliveryStatus.FAILED;
            delivery.payload = { event: 'test' };

            deliveryRepo.findOne.mockResolvedValue(delivery);
            deliveryRepo.save.mockResolvedValue(delivery);

            await service.retryFailedDelivery('delivery-1', 'merchant-123');

            expect(deliveryRepo.findOne).toHaveBeenCalledWith({
                where: { id: 'delivery-1' },
                relations: ['endpoint'],
            });
        });

        it('should prevent cross-merchant retry attempts (regression test)', async () => {
            // Merchant A creates an endpoint and has a failed delivery
            const merchantAEndpoint = new WebhookEndpoint();
            merchantAEndpoint.id = 'endpoint-A';
            merchantAEndpoint.merchantId = 'merchant-A';

            const merchantADelivery = new WebhookDelivery();
            merchantADelivery.id = 'delivery-A';
            merchantADelivery.endpointId = 'endpoint-A';
            merchantADelivery.endpoint = merchantAEndpoint;
            merchantADelivery.status = WebhookDeliveryStatus.FAILED;

            deliveryRepo.findOne.mockResolvedValue(merchantADelivery);

            // Merchant B attempts to retry Merchant A's delivery
            await expect(
                service.retryFailedDelivery('delivery-A', 'merchant-B'),
            ).rejects.toThrow(ForbiddenException);

            // Verify that the delivery status was NOT changed
            expect(deliveryRepo.save).not.toHaveBeenCalled();
            // Verify that the webhook was NOT queued
            expect(webhooksQueue.add).not.toHaveBeenCalled();
        });
    });

    describe('findOwned', () => {
        it('should throw NotFoundException when endpoint does not exist', async () => {
            endpointRepo.findOneBy.mockResolvedValue(null);

            await expect(
                service['findOwned']('non-existent-id', 'merchant-123'),
            ).rejects.toThrow(NotFoundException);
        });

        it('should throw ForbiddenException when endpoint belongs to a different merchant', async () => {
            const endpoint = new WebhookEndpoint();
            endpoint.id = 'endpoint-1';
            endpoint.merchantId = 'merchant-123';

            endpointRepo.findOneBy.mockResolvedValue(endpoint);

            await expect(
                service['findOwned']('endpoint-1', 'merchant-456'),
            ).rejects.toThrow(ForbiddenException);
        });

        it('should return endpoint when it belongs to the authenticated merchant', async () => {
            const endpoint = new WebhookEndpoint();
            endpoint.id = 'endpoint-1';
            endpoint.merchantId = 'merchant-123';

            endpointRepo.findOneBy.mockResolvedValue(endpoint);

            const result = await service['findOwned']('endpoint-1', 'merchant-123');

            expect(result).toBe(endpoint);
        });
    });
});

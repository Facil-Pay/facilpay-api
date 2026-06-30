import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { HttpService } from '@nestjs/axios';
import { WebhooksProcessor } from './webhooks.processor';
import { WebhookDelivery, WebhookDeliveryStatus } from './entities/webhook-delivery.entity';
import { WebhookEndpoint } from './entities/webhook-endpoint.entity';
import { AppLogger } from '../logger/logger.service';
import { of, throwError } from 'rxjs';
import { Job } from 'bullmq';

describe('WebhooksProcessor', () => {
  let processor: WebhooksProcessor;
  let deliveryRepo: any;
  let endpointRepo: any;
  let httpService: any;
  let appLogger: any;

  beforeEach(async () => {
    deliveryRepo = {
      findOne: jest.fn(),
      save: jest.fn(),
    };

    endpointRepo = {
      findOne: jest.fn(),
    };

    httpService = {
      post: jest.fn(),
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
        WebhooksProcessor,
        { provide: getRepositoryToken(WebhookDelivery), useValue: deliveryRepo },
        { provide: getRepositoryToken(WebhookEndpoint), useValue: endpointRepo },
        { provide: HttpService, useValue: httpService },
        { provide: AppLogger, useValue: appLogger },
      ],
    }).compile();

    processor = module.get<WebhooksProcessor>(WebhooksProcessor);
  });

  it('should be defined', () => {
    expect(processor).toBeDefined();
  });

  it('should successfully deliver a webhook', async () => {
    const job = {
      data: { deliveryId: 'd1', endpointId: 'e1', payload: { event: 'test' } },
      attemptsMade: 0,
      opts: { attempts: 6 },
    } as unknown as Job;

    const delivery = new WebhookDelivery();
    const endpoint = new WebhookEndpoint();
    endpoint.secret = 'secret';

    deliveryRepo.findOne.mockResolvedValue(delivery);
    endpointRepo.findOne.mockResolvedValue(endpoint);
    httpService.post.mockReturnValue(of({ status: 200 }));

    const result = await processor.process(job);

    expect(result).toEqual({ success: true, statusCode: 200 });
    expect(delivery.status).toBe(WebhookDeliveryStatus.SUCCESS);
    expect(deliveryRepo.save).toHaveBeenCalledWith(delivery);
  });

  it('should update status to FAILED on initial failure and throw error to trigger retry', async () => {
    const job = {
      data: { deliveryId: 'd1', endpointId: 'e1', payload: { event: 'test' } },
      attemptsMade: 0,
      opts: { attempts: 6 },
    } as unknown as Job;

    const delivery = new WebhookDelivery();
    const endpoint = new WebhookEndpoint();
    endpoint.secret = 'secret';

    deliveryRepo.findOne.mockResolvedValue(delivery);
    endpointRepo.findOne.mockResolvedValue(endpoint);
    httpService.post.mockReturnValue(throwError(() => new Error('Network error')));

    await expect(processor.process(job)).rejects.toThrow('Network error');

    expect(delivery.status).toBe(WebhookDeliveryStatus.FAILED);
    expect(delivery.attempts).toBe(1);
    expect(deliveryRepo.save).toHaveBeenCalledWith(delivery);
  });

  it('should update status to DEAD_LETTER on final failure (5 retries = 6 attempts)', async () => {
    const job = {
      data: { deliveryId: 'd1', endpointId: 'e1', payload: { event: 'test' } },
      attemptsMade: 5,
      opts: { attempts: 6 },
    } as unknown as Job;

    const delivery = new WebhookDelivery();
    const endpoint = new WebhookEndpoint();
    endpoint.secret = 'secret';

    deliveryRepo.findOne.mockResolvedValue(delivery);
    endpointRepo.findOne.mockResolvedValue(endpoint);
    httpService.post.mockReturnValue(throwError(() => new Error('Network error')));

    await expect(processor.process(job)).rejects.toThrow('Network error');

    expect(delivery.status).toBe(WebhookDeliveryStatus.DEAD_LETTER);
    expect(delivery.attempts).toBe(6);
    expect(deliveryRepo.save).toHaveBeenCalledWith(delivery);
  });
});

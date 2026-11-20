import { Test, TestingModule } from '@nestjs/testing';
import { WebhooksController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';
import { EmailNotificationService } from '../notifications/email-notification.service';
import { ConfigService } from '@nestjs/config';
import { CreateWebhookEndpointDto } from './dto/create-webhook-endpoint.dto';
import { UpdateWebhookEndpointDto } from './dto/update-webhook-endpoint.dto';
import { ReplayWebhooksDto } from './dto/replay-webhooks.dto';
import { ListWebhookDeliveriesDto } from './dto/list-webhook-deliveries.dto';
import { RotateWebhookSecretDto } from './dto/rotate-webhook-secret.dto';
import { WebhookEndpoint } from './entities/webhook-endpoint.entity';
import { User } from '../users/user.entity';

describe('WebhooksController', () => {
  let controller: WebhooksController;
  let service: WebhooksService;

  const mockUser: User = {
    id: 'user-123',
    email: 'test@example.com',
  } as User;

  const mockWebhookEndpoint: WebhookEndpoint = {
    id: '123e4567-e89b-12d3-a456-426614174000',
    merchantId: 'user-123',
    url: 'https://merchant.example.com/webhooks',
    events: ['payment.created', 'payment.completed'],
    isActive: true,
    secret: 'whsec_abc123...',
    createdAt: new Date('2026-01-26T10:00:00.000Z'),
    updatedAt: new Date('2026-01-26T10:00:00.000Z'),
  } as WebhookEndpoint;

  const mockWebhooksService = {
    create: jest.fn(),
    findAll: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
    sendTest: jest.fn(),
    rotateSecret: jest.fn(),
    retryFailedDelivery: jest.fn(),
    replayEvents: jest.fn(),
    getReplayProgress: jest.fn(),
    getStats: jest.fn(),
    listDeliveries: jest.fn(),
    reenableEndpoint: jest.fn(),
  };

  const mockEmailNotificationService = {
    sendEmail: jest.fn(),
  };

  const mockConfigService = {
    get: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [WebhooksController],
      providers: [
        {
          provide: WebhooksService,
          useValue: mockWebhooksService,
        },
        {
          provide: EmailNotificationService,
          useValue: mockEmailNotificationService,
        },
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
      ],
    }).compile();

    controller = module.get<WebhooksController>(WebhooksController);
    service = module.get<WebhooksService>(WebhooksService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('create', () => {
    it('should create a webhook endpoint', async () => {
      const dto: CreateWebhookEndpointDto = {
        url: 'https://merchant.example.com/webhooks',
        events: ['payment.created', 'payment.completed'],
      } as CreateWebhookEndpointDto;

      mockWebhooksService.create.mockResolvedValue(mockWebhookEndpoint);

      const result = await controller.create(dto, mockUser);

      expect(service.create).toHaveBeenCalledWith(dto, mockUser.id);
      expect(result).toBeDefined();
    });
  });

  describe('findAll', () => {
    it('should return all webhook endpoints for the user', async () => {
      const endpoints = [mockWebhookEndpoint];
      mockWebhooksService.findAll.mockResolvedValue(endpoints);

      const result = await controller.findAll(mockUser);

      expect(service.findAll).toHaveBeenCalledWith(mockUser.id);
      expect(result).toHaveLength(1);
    });
  });

  describe('update', () => {
    it('should update a webhook endpoint', async () => {
      const dto: UpdateWebhookEndpointDto = {
        url: 'https://merchant.example.com/webhooks/v2',
        events: ['payment.completed', 'refund.issued'],
      } as UpdateWebhookEndpointDto;

      const updatedEndpoint = {
        ...mockWebhookEndpoint,
        url: dto.url,
        events: dto.events,
        updatedAt: new Date('2026-01-26T11:00:00.000Z'),
      };

      mockWebhooksService.update.mockResolvedValue(updatedEndpoint);

      const result = await controller.update(mockWebhookEndpoint.id, dto, mockUser);

      expect(service.update).toHaveBeenCalledWith(mockWebhookEndpoint.id, dto, mockUser.id);
      expect(result).toBeDefined();
    });
  });

  describe('remove', () => {
    it('should delete a webhook endpoint', async () => {
      mockWebhooksService.remove.mockResolvedValue(undefined);

      await controller.remove(mockWebhookEndpoint.id, mockUser);

      expect(service.remove).toHaveBeenCalledWith(mockWebhookEndpoint.id, mockUser.id);
    });
  });

  describe('sendTest', () => {
    it('should send a test event successfully', async () => {
      const testResult = {
        delivered: true,
        statusCode: 200,
        error: null,
      };

      mockWebhooksService.sendTest.mockResolvedValue(testResult);

      const result = await controller.sendTest(mockWebhookEndpoint.id, mockUser);

      expect(result).toEqual(testResult);
      expect(service.sendTest).toHaveBeenCalledWith(mockWebhookEndpoint.id, mockUser.id);
    });

    it('should return error when test delivery fails', async () => {
      const testResult = {
        delivered: false,
        statusCode: 500,
        error: 'connect ECONNREFUSED 127.0.0.1:4000',
      };

      mockWebhooksService.sendTest.mockResolvedValue(testResult);

      const result = await controller.sendTest(mockWebhookEndpoint.id, mockUser);

      expect(result).toEqual(testResult);
      expect(result.delivered).toBe(false);
    });
  });

  describe('rotateSecret', () => {
    it('should rotate webhook secret with default grace period', async () => {
      const dto: RotateWebhookSecretDto = {};
      const rotatedEndpoint = {
        ...mockWebhookEndpoint,
        secret: 'whsec_newsecret123...',
        previousSecret: '********',
        previousSecretExpiresAt: new Date('2026-01-27T12:00:00.000Z'),
        updatedAt: new Date('2026-01-26T12:00:00.000Z'),
      } as WebhookEndpoint;

      mockWebhooksService.rotateSecret.mockResolvedValue(rotatedEndpoint);

      const result = await controller.rotateSecret(mockWebhookEndpoint.id, dto, mockUser);

      expect(service.rotateSecret).toHaveBeenCalledWith(
        mockWebhookEndpoint.id,
        mockUser.id,
        undefined,
      );
      expect(result).toBeDefined();
    });

    it('should rotate webhook secret with custom grace period', async () => {
      const dto: RotateWebhookSecretDto = { gracePeriodHours: 48 };
      const rotatedEndpoint = {
        ...mockWebhookEndpoint,
        secret: 'whsec_newsecret123...',
        previousSecret: '********',
        previousSecretExpiresAt: new Date('2026-01-28T12:00:00.000Z'),
      } as WebhookEndpoint;

      mockWebhooksService.rotateSecret.mockResolvedValue(rotatedEndpoint);

      await controller.rotateSecret(mockWebhookEndpoint.id, dto, mockUser);

      expect(service.rotateSecret).toHaveBeenCalledWith(
        mockWebhookEndpoint.id,
        mockUser.id,
        48,
      );
    });
  });

  describe('retryFailedDelivery', () => {
    it('should retry a failed webhook delivery', async () => {
      const deliveryId = '456e7890-e89b-12d3-a456-426614174000';
      mockWebhooksService.retryFailedDelivery.mockResolvedValue(undefined);

      await controller.retryFailedDelivery(deliveryId, mockUser);

      expect(service.retryFailedDelivery).toHaveBeenCalledWith(deliveryId, mockUser.id);
    });
  });

  describe('replay', () => {
    it('should queue webhook replay', async () => {
      const dto: ReplayWebhooksDto = {
        from: new Date('2026-01-20T00:00:00.000Z'),
        to: new Date('2026-01-26T00:00:00.000Z'),
        events: ['payment.created'],
      } as ReplayWebhooksDto;

      const replayResponse = { jobId: 'replay-job-123' };
      mockWebhooksService.replayEvents.mockResolvedValue(replayResponse);

      const result = await controller.replay(mockWebhookEndpoint.id, dto, mockUser);

      expect(service.replayEvents).toHaveBeenCalledWith(
        mockWebhookEndpoint.id,
        mockUser.id,
        dto,
      );
      expect(result).toEqual(replayResponse);
    });
  });

  describe('getReplayProgress', () => {
    it('should return replay job progress', async () => {
      const jobId = 'replay-job-123';
      const progress = {
        jobId,
        status: 'in_progress',
        totalEvents: 150,
        processedEvents: 75,
        failedEvents: 2,
      };

      mockWebhooksService.getReplayProgress.mockResolvedValue(progress);

      const result = await controller.getReplayProgress(jobId, mockUser);

      expect(service.getReplayProgress).toHaveBeenCalledWith(jobId, mockUser.id);
      expect(result).toEqual(progress);
    });
  });

  describe('getStats', () => {
    it('should return webhook delivery statistics', async () => {
      const stats = {
        last24Hours: {
          successRate: 0.98,
          totalDeliveries: 500,
          avgLatencyMs: 145,
        },
        last7Days: {
          successRate: 0.97,
          totalDeliveries: 3500,
          avgLatencyMs: 152,
        },
      };

      mockWebhooksService.getStats.mockResolvedValue(stats);

      const result = await controller.getStats(mockWebhookEndpoint.id, mockUser);

      expect(service.getStats).toHaveBeenCalledWith(mockWebhookEndpoint.id, mockUser.id);
      expect(result).toEqual(stats);
    });
  });

  describe('listDeliveries', () => {
    it('should return paginated webhook deliveries', async () => {
      const dto: ListWebhookDeliveriesDto = {
        page: 1,
        limit: 20,
      } as ListWebhookDeliveriesDto;

      const deliveries = {
        data: [
          {
            id: '5f0c7a3e-6b52-4f4e-9d3b-0d6f1c2f9a10',
            eventType: 'payment.completed',
            status: 'failed',
            attempts: 2,
            responseCode: 500,
            latencyMs: 182,
            responseBody: '{"error":"upstream timeout"}',
            error: 'Request failed with status code 500',
            lastAttemptAt: new Date('2026-01-26T10:00:05.000Z'),
            createdAt: new Date('2026-01-26T10:00:00.000Z'),
          },
        ],
        total: 1,
        page: 1,
        limit: 20,
      };

      mockWebhooksService.listDeliveries.mockResolvedValue(deliveries);

      const result = await controller.listDeliveries(mockWebhookEndpoint.id, dto, mockUser);

      expect(service.listDeliveries).toHaveBeenCalledWith(
        mockWebhookEndpoint.id,
        mockUser.id,
        dto,
      );
      expect(result).toEqual(deliveries);
    });
  });

  describe('reenable', () => {
    it('should re-enable a disabled webhook endpoint', async () => {
      const reenabledEndpoint = {
        ...mockWebhookEndpoint,
        isActive: true,
        updatedAt: new Date('2026-01-26T12:00:00.000Z'),
      };

      mockWebhooksService.reenableEndpoint.mockResolvedValue(reenabledEndpoint);

      const result = await controller.reenable(mockWebhookEndpoint.id, mockUser);

      expect(service.reenableEndpoint).toHaveBeenCalledWith(
        mockWebhookEndpoint.id,
        mockUser.id,
      );
      expect(result).toBeDefined();
    });
  });
});

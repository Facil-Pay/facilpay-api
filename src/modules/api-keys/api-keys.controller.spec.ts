import { Test, TestingModule } from '@nestjs/testing';
import { ApiKeysController } from './api-keys.controller';
import { ApiKeysService } from './api-keys.service';
import { CreateApiKeyDto } from './dto/create-api-key.dto';
import { UpdateApiKeyDto } from './dto/update-api-key.dto';
import { GetApiKeyUsageDto } from './dto/get-api-key-usage.dto';
import { User } from '../users/user.entity';
import { ApiKey } from './api-key.entity';
import { Request } from 'express';

describe('ApiKeysController', () => {
  let controller: ApiKeysController;
  let service: ApiKeysService;

  const mockUser: User = {
    id: 'user-123',
    email: 'test@example.com',
  } as User;

  const mockApiKey: ApiKey = {
    id: '550e8400-e29b-41d4-a716-446655440000',
    name: 'My integration',
    keyPrefix: 'fp_live_xxxx',
    scope: 'read',
    environment: 'live',
    expiresAt: null,
    lastUsedAt: null,
    isActive: true,
    createdAt: new Date('2026-06-28T10:00:00.000Z'),
  } as ApiKey;

  const mockApiKeysService = {
    create: jest.fn(),
    findAllForUser: jest.fn(),
    findById: jest.fn(),
    update: jest.fn(),
    revoke: jest.fn(),
    rotate: jest.fn(),
    getUsageHistory: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ApiKeysController],
      providers: [
        {
          provide: ApiKeysService,
          useValue: mockApiKeysService,
        },
      ],
    }).compile();

    controller = module.get<ApiKeysController>(ApiKeysController);
    service = module.get<ApiKeysService>(ApiKeysService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('create', () => {
    it('should create a new API key', async () => {
      const dto: CreateApiKeyDto = {
        name: 'My integration',
        scope: 'read',
        environment: 'live',
      } as CreateApiKeyDto;

      const mockRequest = {
        ip: '192.168.1.1',
        headers: { 'user-agent': 'Mozilla/5.0' },
      } as Request;

      const expectedResult = {
        apiKey: mockApiKey,
        plaintext: 'fp_live_abc123...',
      };

      mockApiKeysService.create.mockResolvedValue(expectedResult);

      const result = await controller.create(mockUser, dto, mockRequest);

      expect(result).toEqual(expectedResult);
      expect(service.create).toHaveBeenCalledWith(
        mockUser.id,
        dto,
        mockUser.id,
        mockRequest.ip,
        mockRequest.headers['user-agent'],
      );
    });
  });

  describe('findAll', () => {
    it('should return all API keys for the current user', async () => {
      const expectedResult = [mockApiKey];
      mockApiKeysService.findAllForUser.mockResolvedValue(expectedResult);

      const result = await controller.findAll(mockUser);

      expect(result).toEqual(expectedResult);
      expect(service.findAllForUser).toHaveBeenCalledWith(mockUser.id);
    });
  });

  describe('findById', () => {
    it('should return a single API key by ID', async () => {
      const keyId = '550e8400-e29b-41d4-a716-446655440000';
      mockApiKeysService.findById.mockResolvedValue(mockApiKey);

      const result = await controller.findById(keyId, mockUser);

      expect(result).toEqual(mockApiKey);
      expect(service.findById).toHaveBeenCalledWith(keyId, mockUser.id);
    });
  });

  describe('update', () => {
    it('should update an API key', async () => {
      const keyId = '550e8400-e29b-41d4-a716-446655440000';
      const dto: UpdateApiKeyDto = {
        name: 'Updated integration',
        scope: 'write',
      } as UpdateApiKeyDto;

      const updatedKey = { ...mockApiKey, ...dto };
      mockApiKeysService.update.mockResolvedValue(updatedKey);

      const result = await controller.update(keyId, mockUser, dto);

      expect(result).toEqual(updatedKey);
      expect(service.update).toHaveBeenCalledWith(keyId, mockUser.id, dto);
    });
  });

  describe('revoke', () => {
    it('should revoke an API key', async () => {
      const keyId = '550e8400-e29b-41d4-a716-446655440000';
      const mockRequest = {
        ip: '192.168.1.1',
        headers: { 'user-agent': 'Mozilla/5.0' },
      } as Request;

      mockApiKeysService.revoke.mockResolvedValue(undefined);

      const result = await controller.revoke(keyId, mockUser, mockRequest);

      expect(result).toBeUndefined();
      expect(service.revoke).toHaveBeenCalledWith(
        keyId,
        mockUser.id,
        mockUser.id,
        mockRequest.ip,
        mockRequest.headers['user-agent'],
      );
    });
  });

  describe('rotate', () => {
    it('should rotate an API key', async () => {
      const keyId = '550e8400-e29b-41d4-a716-446655440000';
      const mockRequest = {
        ip: '192.168.1.1',
        headers: { 'user-agent': 'Mozilla/5.0' },
      } as Request;

      const expectedResult = {
        apiKey: {
          ...mockApiKey,
          id: '660e8400-e29b-41d4-a716-446655440001',
          keyPrefix: 'fp_live_yyyy',
        },
        plaintext: 'fp_live_xyz789...',
      };

      mockApiKeysService.rotate.mockResolvedValue(expectedResult);

      const result = await controller.rotate(keyId, mockUser, mockRequest);

      expect(result).toEqual(expectedResult);
      expect(service.rotate).toHaveBeenCalledWith(
        keyId,
        mockUser.id,
        mockUser.id,
        mockRequest.ip,
        mockRequest.headers['user-agent'],
      );
    });
  });

  describe('getUsageHistory', () => {
    it('should return API key usage history', async () => {
      const keyId = '550e8400-e29b-41d4-a716-446655440000';
      const dto: GetApiKeyUsageDto = {
        page: 1,
        limit: 20,
      } as GetApiKeyUsageDto;

      const expectedResult = {
        data: [
          {
            id: 'usage-uuid-1',
            apiKeyId: keyId,
            endpoint: '/v1/payments',
            method: 'POST',
            sourceIp: '192.168.1.1',
            userAgent: 'Mozilla/5.0...',
            statusCode: 201,
            createdAt: new Date('2026-07-28T10:00:00.000Z'),
          },
        ],
        total: 150,
        page: 1,
        limit: 20,
      };

      mockApiKeysService.getUsageHistory.mockResolvedValue(expectedResult);

      const result = await controller.getUsageHistory(keyId, mockUser, dto);

      expect(result).toEqual(expectedResult);
      expect(service.getUsageHistory).toHaveBeenCalledWith(keyId, mockUser.id, dto);
    });
  });
});

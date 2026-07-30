import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { ApiKeysService } from './api-keys.service';
import { ApiKey, ApiKeyScope, ApiKeyEnvironment } from './api-key.entity';
import { ApiKeyUsage } from './api-key-usage.entity';
import { NotFoundException } from '@nestjs/common';

describe('ApiKeysService', () => {
    let service: ApiKeysService;
    let apiKeyRepository: any;
    let apiKeyUsageRepository: any;
    let configService: any;

    beforeEach(async () => {
        apiKeyRepository = {
            create: jest.fn(),
            save: jest.fn(),
            find: jest.fn(),
            findOne: jest.fn(),
            delete: jest.fn(),
        };

        apiKeyUsageRepository = {
            create: jest.fn(),
            save: jest.fn(),
            createQueryBuilder: jest.fn(),
            delete: jest.fn(),
        };

        configService = {
            get: jest.fn(),
        };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                ApiKeysService,
                { provide: getRepositoryToken(ApiKey), useValue: apiKeyRepository },
                { provide: getRepositoryToken(ApiKeyUsage), useValue: apiKeyUsageRepository },
                { provide: ConfigService, useValue: configService },
            ],
        }).compile();

        service = module.get<ApiKeysService>(ApiKeysService);
    });

    it('should be defined', () => {
        expect(service).toBeDefined();
    });

    describe('update', () => {
        it('should update API key name', async () => {
            const existingKey = new ApiKey();
            existingKey.id = 'key-1';
            existingKey.userId = 'user-1';
            existingKey.name = 'Old Name';
            existingKey.scope = ApiKeyScope.READ;
            existingKey.isActive = true;

            apiKeyRepository.findOne.mockResolvedValue(existingKey);
            apiKeyRepository.save.mockResolvedValue({ ...existingKey, name: 'New Name' });

            const result = await service.update('key-1', 'user-1', { name: 'New Name' });

            expect(apiKeyRepository.findOne).toHaveBeenCalledWith({
                where: { id: 'key-1', userId: 'user-1', isActive: true },
            });
            expect(existingKey.name).toBe('New Name');
            expect(apiKeyRepository.save).toHaveBeenCalledWith(existingKey);
        });

        it('should update API key scope', async () => {
            const existingKey = new ApiKey();
            existingKey.id = 'key-1';
            existingKey.userId = 'user-1';
            existingKey.name = 'My Key';
            existingKey.scope = ApiKeyScope.READ;
            existingKey.isActive = true;

            apiKeyRepository.findOne.mockResolvedValue(existingKey);
            apiKeyRepository.save.mockResolvedValue({ ...existingKey, scope: ApiKeyScope.WRITE });

            const result = await service.update('key-1', 'user-1', { scope: ApiKeyScope.WRITE });

            expect(existingKey.scope).toBe(ApiKeyScope.WRITE);
            expect(apiKeyRepository.save).toHaveBeenCalledWith(existingKey);
        });

        it('should update API key rate limit settings', async () => {
            const existingKey = new ApiKey();
            existingKey.id = 'key-1';
            existingKey.userId = 'user-1';
            existingKey.name = 'My Key';
            existingKey.scope = ApiKeyScope.READ;
            existingKey.isActive = true;
            existingKey.rateLimitLimit = null;
            existingKey.rateLimitTtl = null;

            apiKeyRepository.findOne.mockResolvedValue(existingKey);
            apiKeyRepository.save.mockResolvedValue({
                ...existingKey,
                rateLimitLimit: 500,
                rateLimitTtl: 60000,
            });

            const result = await service.update('key-1', 'user-1', {
                rateLimitLimit: 500,
                rateLimitTtl: 60000,
            });

            expect(existingKey.rateLimitLimit).toBe(500);
            expect(existingKey.rateLimitTtl).toBe(60000);
            expect(apiKeyRepository.save).toHaveBeenCalledWith(existingKey);
        });

        it('should update multiple fields simultaneously', async () => {
            const existingKey = new ApiKey();
            existingKey.id = 'key-1';
            existingKey.userId = 'user-1';
            existingKey.name = 'Old Name';
            existingKey.scope = ApiKeyScope.READ;
            existingKey.isActive = true;
            existingKey.rateLimitLimit = null;

            apiKeyRepository.findOne.mockResolvedValue(existingKey);
            apiKeyRepository.save.mockResolvedValue({
                ...existingKey,
                name: 'New Name',
                scope: ApiKeyScope.WRITE,
                rateLimitLimit: 1000,
            });

            const result = await service.update('key-1', 'user-1', {
                name: 'New Name',
                scope: ApiKeyScope.WRITE,
                rateLimitLimit: 1000,
            });

            expect(existingKey.name).toBe('New Name');
            expect(existingKey.scope).toBe(ApiKeyScope.WRITE);
            expect(existingKey.rateLimitLimit).toBe(1000);
            expect(apiKeyRepository.save).toHaveBeenCalledWith(existingKey);
        });

        it('should throw NotFoundException when API key does not exist', async () => {
            apiKeyRepository.findOne.mockResolvedValue(null);

            await expect(
                service.update('non-existent', 'user-1', { name: 'New Name' }),
            ).rejects.toThrow(NotFoundException);
            await expect(
                service.update('non-existent', 'user-1', { name: 'New Name' }),
            ).rejects.toThrow('API key with ID non-existent not found');
        });

        it('should throw NotFoundException when API key belongs to different user', async () => {
            apiKeyRepository.findOne.mockResolvedValue(null);

            await expect(
                service.update('key-1', 'user-2', { name: 'New Name' }),
            ).rejects.toThrow(NotFoundException);
        });

        it('should throw NotFoundException when API key is inactive', async () => {
            apiKeyRepository.findOne.mockResolvedValue(null);

            await expect(
                service.update('inactive-key', 'user-1', { name: 'New Name' }),
            ).rejects.toThrow(NotFoundException);
        });

        it('should handle partial updates without affecting other fields', async () => {
            const existingKey = new ApiKey();
            existingKey.id = 'key-1';
            existingKey.userId = 'user-1';
            existingKey.name = 'Original Name';
            existingKey.scope = ApiKeyScope.READ;
            existingKey.rateLimitLimit = 100;
            existingKey.rateLimitTtl = 30000;
            existingKey.isActive = true;

            apiKeyRepository.findOne.mockResolvedValue(existingKey);
            apiKeyRepository.save.mockResolvedValue({ ...existingKey, name: 'Updated Name' });

            await service.update('key-1', 'user-1', { name: 'Updated Name' });

            // Verify other fields remain unchanged
            expect(existingKey.scope).toBe(ApiKeyScope.READ);
            expect(existingKey.rateLimitLimit).toBe(100);
            expect(existingKey.rateLimitTtl).toBe(30000);
        });
    });

    describe('rotate', () => {
        it('should rotate an API key successfully', async () => {
            const existingKey = new ApiKey();
            existingKey.id = 'key-1';
            existingKey.userId = 'user-1';
            existingKey.name = 'My Integration';
            existingKey.scope = ApiKeyScope.READ;
            existingKey.environment = ApiKeyEnvironment.LIVE;
            existingKey.expiresAt = null;
            existingKey.isActive = true;

            const newKey = new ApiKey();
            newKey.id = 'key-2';
            newKey.userId = 'user-1';
            newKey.name = 'My Integration';
            newKey.scope = ApiKeyScope.READ;
            newKey.environment = ApiKeyEnvironment.LIVE;
            newKey.isActive = true;

            apiKeyRepository.findOne.mockResolvedValue(existingKey);
            apiKeyRepository.create.mockReturnValue(newKey);
            apiKeyRepository.save.mockImplementation((key) => Promise.resolve(key));

            const result = await service.rotate('key-1', 'user-1');

            expect(existingKey.isActive).toBe(false);
            expect(result.apiKey).toBe(newKey);
            expect(result.plaintext).toMatch(/^fp_live_/);
            expect(apiKeyRepository.save).toHaveBeenCalledTimes(2); // once for deactivating old, once for saving new
        });

        it('should preserve name, scope, and environment when rotating', async () => {
            const existingKey = new ApiKey();
            existingKey.id = 'key-1';
            existingKey.userId = 'user-1';
            existingKey.name = 'Production Key';
            existingKey.scope = ApiKeyScope.WRITE;
            existingKey.environment = ApiKeyEnvironment.LIVE;
            existingKey.expiresAt = new Date('2027-01-01');
            existingKey.isActive = true;

            apiKeyRepository.findOne.mockResolvedValue(existingKey);
            apiKeyRepository.create.mockImplementation((data) => {
                const key = new ApiKey();
                Object.assign(key, data);
                return key;
            });
            apiKeyRepository.save.mockImplementation((key) => Promise.resolve(key));

            const result = await service.rotate('key-1', 'user-1');

            expect(apiKeyRepository.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    name: 'Production Key',
                    scope: ApiKeyScope.WRITE,
                    environment: ApiKeyEnvironment.LIVE,
                    expiresAt: existingKey.expiresAt,
                }),
            );
        });

        it('should throw NotFoundException when API key does not exist', async () => {
            apiKeyRepository.findOne.mockResolvedValue(null);

            await expect(service.rotate('non-existent', 'user-1')).rejects.toThrow(NotFoundException);
        });
    });
});

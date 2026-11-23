import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { ApiKeysService } from './api-keys.service';
import { ApiKey, ApiKeyScope, ApiKeyEnvironment } from './api-key.entity';
import { ApiKeyUsage } from './api-key-usage.entity';
import { NotFoundException } from '@nestjs/common';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { EmailNotificationService } from '../notifications/email-notification.service';

function createWarningSelectionBuilder(rows: unknown[]) {
    const builder: any = {
        innerJoin: jest.fn(),
        select: jest.fn(),
        addSelect: jest.fn(),
        where: jest.fn(),
        andWhere: jest.fn(),
        getRawMany: jest.fn().mockResolvedValue(rows),
    };
    for (const method of ['innerJoin', 'select', 'addSelect', 'where', 'andWhere']) {
        builder[method].mockReturnValue(builder);
    }
    return builder;
}

function createWarningUpdateBuilder(affected: number) {
    const builder: any = {
        update: jest.fn(),
        set: jest.fn(),
        where: jest.fn(),
        andWhere: jest.fn(),
        execute: jest.fn().mockResolvedValue({ affected }),
    };
    for (const method of ['update', 'set', 'where', 'andWhere']) {
        builder[method].mockReturnValue(builder);
    }
    return builder;
}

describe('ApiKeysService', () => {
    let service: ApiKeysService;
    let apiKeyRepository: any;
    let apiKeyUsageRepository: any;
    let configService: any;
    let emailNotificationService: any;

    beforeEach(async () => {
        apiKeyRepository = {
            create: jest.fn(),
            createQueryBuilder: jest.fn(),
            save: jest.fn(),
            find: jest.fn(),
            findOne: jest.fn(),
            delete: jest.fn(),
            update: jest.fn().mockResolvedValue({ affected: 1 }),
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
        emailNotificationService = {
            sendApiKeyExpiryWarning: jest.fn().mockResolvedValue(undefined),
        };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                ApiKeysService,
                { provide: getRepositoryToken(ApiKey), useValue: apiKeyRepository },
                { provide: getRepositoryToken(ApiKeyUsage), useValue: apiKeyUsageRepository },
                { provide: ConfigService, useValue: configService },
                { provide: AuditLogsService, useValue: { record: jest.fn().mockResolvedValue(undefined) } },
                {
                    provide: EmailNotificationService,
                    useValue: emailNotificationService,
                },
            ],
        }).compile();

        service = module.get<ApiKeysService>(ApiKeysService);
    });

    it('should be defined', () => {
        expect(service).toBeDefined();
    });

    describe('validateKey inactivity tracking', () => {
        it('updates last-used tracking and clears a pending inactivity warning', async () => {
            apiKeyRepository.findOne.mockResolvedValue({ id: 'key', userId: 'owner', isActive: true, expiresAt: null, allowedIps: [] });
            await service.validateKey('plaintext');
            expect(apiKeyRepository.update).toHaveBeenCalledWith({ id: 'key', isActive: true }, {
                lastUsedAt: expect.any(Date), inactivityWarningAt: null, inactivityRevokeAt: null,
            });
            expect(apiKeyRepository.save).not.toHaveBeenCalled();
        });
        it('rejects a key revoked concurrently without reactivating it', async () => {
            apiKeyRepository.findOne.mockResolvedValue({ id: 'key', isActive: true, expiresAt: null, allowedIps: [] });
            apiKeyRepository.update.mockResolvedValue({ affected: 0 });
            await expect(service.validateKey('plaintext')).rejects.toThrow('Invalid API key');
            expect(apiKeyRepository.save).not.toHaveBeenCalled();
        });
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

    describe('sendExpiryWarnings', () => {
        it('queues one warning for each configured expiry threshold', async () => {
            const today = new Date('2026-03-01T12:00:00.000Z');
            const queryBuilders: any[] = [];
            for (const days of [14, 7, 1]) {
                queryBuilders.push(
                    createWarningSelectionBuilder([{
                        id: `key-${days}`,
                        userId: 'user-1',
                        name: `Key ${days}`,
                        keyPrefix: 'fp_live_abcd',
                        expiresAt: new Date(Date.UTC(2026, 2, 1 + days, 10)),
                        lastExpiryWarningDays: null,
                        ownerEmail: 'owner@example.com',
                    }]),
                    createWarningUpdateBuilder(1),
                );
            }
            apiKeyRepository.createQueryBuilder.mockImplementation(() => queryBuilders.shift());

            const result = await service.sendExpiryWarnings(today);

            expect(result).toBe(3);
            expect(emailNotificationService.sendApiKeyExpiryWarning).toHaveBeenCalledTimes(3);
            expect(emailNotificationService.sendApiKeyExpiryWarning.mock.calls.map(([warning]) => warning.daysUntilExpiry))
                .toEqual([14, 7, 1]);
            expect(emailNotificationService.sendApiKeyExpiryWarning).toHaveBeenCalledWith(
                expect.objectContaining({
                    keyName: 'Key 14',
                    keyPrefix: 'fp_live_abcd',
                    to: 'owner@example.com',
                    rotateUrl: expect.stringContaining('rotate=key-14'),
                }),
            );
        });

        it('does not send a duplicate when another scheduler has claimed the threshold', async () => {
            const queryBuilders: any[] = [
                createWarningSelectionBuilder([{
                    id: 'key-14',
                    userId: 'user-1',
                    name: 'Production',
                    keyPrefix: 'fp_live_abcd',
                    expiresAt: new Date('2026-03-15T10:00:00.000Z'),
                    lastExpiryWarningDays: null,
                    ownerEmail: 'owner@example.com',
                }]),
                createWarningUpdateBuilder(0),
                createWarningSelectionBuilder([]),
                createWarningSelectionBuilder([]),
            ];
            apiKeyRepository.createQueryBuilder.mockImplementation(() => queryBuilders.shift());

            const result = await service.sendExpiryWarnings(new Date('2026-03-01T12:00:00.000Z'));

            expect(result).toBe(0);
            expect(emailNotificationService.sendApiKeyExpiryWarning).not.toHaveBeenCalled();
        });

        it('filters revoked keys out of the expiry scan', async () => {
            const selectionBuilders = [
                createWarningSelectionBuilder([]),
                createWarningSelectionBuilder([]),
                createWarningSelectionBuilder([]),
            ];
            const queryBuilders = [...selectionBuilders];
            apiKeyRepository.createQueryBuilder.mockImplementation(() => queryBuilders.shift());

            await service.sendExpiryWarnings(new Date('2026-03-01T12:00:00.000Z'));

            expect(apiKeyRepository.createQueryBuilder).toHaveBeenCalledTimes(3);
            for (const builder of selectionBuilders) {
                expect(builder.where).toHaveBeenCalledWith('apiKey.isActive = true');
            }
            expect(emailNotificationService.sendApiKeyExpiryWarning).not.toHaveBeenCalled();
        });
    });
});

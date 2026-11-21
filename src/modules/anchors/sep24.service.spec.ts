import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, SelectQueryBuilder } from 'typeorm';
import {
  NotFoundException,
  ConflictException,
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

jest.mock('../logger/logger.service', () => ({
  AppLogger: class AppLogger {
    child() {
      return { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    }
  },
}));
jest.mock('../stellar/stellar.service');
jest.mock('../webhooks/webhooks.service');
jest.mock('../events/events.service');

import { Sep24Service, parseStellarToml } from './sep24.service';
import { AnchorConfig } from './entities/anchor-config.entity';
import { AnchorWithdrawal, AnchorWithdrawalStatus } from './entities/anchor-withdrawal.entity';
import { StellarService } from '../stellar/stellar.service';
import { WebhooksService } from '../webhooks/webhooks.service';
import { EventsService } from '../events/events.service';
import { AppLogger } from '../logger/logger.service';

// ── helpers ──────────────────────────────────────────────────────────────────

function makeRepo(overrides: Partial<Record<string, jest.Mock>> = {}) {
  return {
    findOne: jest.fn(),
    findOneBy: jest.fn(),
    find: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    remove: jest.fn(),
    createQueryBuilder: jest.fn(),
    ...overrides,
  };
}

function makeQb(items: any[] = [], total = 0) {
  const qb: any = {
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    take: jest.fn().mockReturnThis(),
    leftJoinAndSelect: jest.fn().mockReturnThis(),
    getManyAndCount: jest.fn().mockResolvedValue([items, total]),
    getMany: jest.fn().mockResolvedValue(items),
  };
  return qb;
}

const FAKE_SECRET = 'SCZW2UDX4YC7TXGXBHWI5RUFLQMT2AGLG6ILLUM57X7HBLNTQUQ5N5YA';

// ── tests ─────────────────────────────────────────────────────────────────────

describe('Sep24Service', () => {
  let service: Sep24Service;
  let anchorConfigRepo: ReturnType<typeof makeRepo>;
  let withdrawalRepo: ReturnType<typeof makeRepo>;
  let stellarService: jest.Mocked<StellarService>;
  let webhooksService: jest.Mocked<WebhooksService>;
  let eventsService: { emit: jest.Mock };
  let configService: { get: jest.Mock };

  const makeAnchorConfig = (overrides: Partial<AnchorConfig> = {}): AnchorConfig => ({
    id: 'cfg-1',
    merchantId: 'merchant-1',
    homeDomain: 'testanchor.stellar.org',
    supportedAssets: ['USDC', 'SRT'],
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });

  beforeEach(async () => {
    anchorConfigRepo = makeRepo();
    withdrawalRepo = makeRepo();
    eventsService = { emit: jest.fn() };
    configService = {
      get: jest.fn().mockImplementation((key: string, def?: any) => {
        if (key === 'STELLAR_SOURCE_SECRET') return FAKE_SECRET;
        if (key === 'STELLAR_NETWORK') return 'TESTNET';
        return def;
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        Sep24Service,
        { provide: getRepositoryToken(AnchorConfig), useValue: anchorConfigRepo },
        { provide: getRepositoryToken(AnchorWithdrawal), useValue: withdrawalRepo },
        { provide: DataSource, useValue: {} },
        { provide: ConfigService, useValue: configService },
        { provide: StellarService, useValue: { sendPayout: jest.fn() } },
        { provide: WebhooksService, useValue: { dispatchEventToMerchant: jest.fn().mockResolvedValue(undefined) } },
        { provide: EventsService, useValue: eventsService },
        { provide: AppLogger, useValue: new (AppLogger as any)() },
      ],
    }).compile();

    service = module.get(Sep24Service);
    stellarService = module.get(StellarService) as jest.Mocked<StellarService>;
    webhooksService = module.get(WebhooksService) as jest.Mocked<WebhooksService>;
  });

  afterEach(() => jest.clearAllMocks());

  // ── parseStellarToml ──────────────────────────────────────────────────────

  describe('parseStellarToml()', () => {
    it('parses key=value pairs', () => {
      const toml = `
# comment
TRANSFER_SERVER_SEP0024="https://anchor.example.com/sep24"
WEB_AUTH_ENDPOINT = 'https://anchor.example.com/auth'
NETWORK_PASSPHRASE="Test SDF Network ; September 2015"
      `;
      const result = parseStellarToml(toml);
      expect(result['TRANSFER_SERVER_SEP0024']).toBe('https://anchor.example.com/sep24');
      expect(result['WEB_AUTH_ENDPOINT']).toBe('https://anchor.example.com/auth');
    });

    it('skips blank lines and comments', () => {
      const result = parseStellarToml('# comment\n\nFOO=bar');
      expect(result).toEqual({ FOO: 'bar' });
    });
  });

  // ── createAnchorConfig ────────────────────────────────────────────────────

  describe('createAnchorConfig()', () => {
    it('creates and saves a new config', async () => {
      anchorConfigRepo.findOne.mockResolvedValue(null);
      const cfg = makeAnchorConfig();
      anchorConfigRepo.create.mockReturnValue(cfg);
      anchorConfigRepo.save.mockResolvedValue(cfg);

      const result = await service.createAnchorConfig('merchant-1', {
        homeDomain: 'testanchor.stellar.org',
        supportedAssets: ['usdc'],
      });

      expect(anchorConfigRepo.save).toHaveBeenCalled();
      expect(result).toBe(cfg);
    });

    it('throws ConflictException when the domain already exists', async () => {
      anchorConfigRepo.findOne.mockResolvedValue(makeAnchorConfig());
      await expect(
        service.createAnchorConfig('merchant-1', {
          homeDomain: 'testanchor.stellar.org',
          supportedAssets: ['USDC'],
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('upper-cases asset codes', async () => {
      anchorConfigRepo.findOne.mockResolvedValue(null);
      const saved = makeAnchorConfig({ supportedAssets: ['USDC'] });
      anchorConfigRepo.create.mockReturnValue(saved);
      anchorConfigRepo.save.mockResolvedValue(saved);

      await service.createAnchorConfig('merchant-1', {
        homeDomain: 'testanchor.stellar.org',
        supportedAssets: ['usdc'],
      });

      expect(anchorConfigRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ supportedAssets: ['USDC'] }),
      );
    });
  });

  // ── deleteAnchorConfig ────────────────────────────────────────────────────

  describe('deleteAnchorConfig()', () => {
    it('removes the config', async () => {
      const cfg = makeAnchorConfig();
      anchorConfigRepo.findOne.mockResolvedValue(cfg);
      await service.deleteAnchorConfig('merchant-1', 'cfg-1');
      expect(anchorConfigRepo.remove).toHaveBeenCalledWith(cfg);
    });

    it('throws NotFoundException for a missing config', async () => {
      anchorConfigRepo.findOne.mockResolvedValue(null);
      await expect(service.deleteAnchorConfig('merchant-1', 'missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ── startWithdrawal ───────────────────────────────────────────────────────

  describe('startWithdrawal()', () => {
    it('throws NotFoundException when anchor config is missing or inactive', async () => {
      anchorConfigRepo.findOne.mockResolvedValue(null);
      await expect(
        service.startWithdrawal('merchant-1', {
          anchorConfigId: 'cfg-1',
          assetCode: 'USDC',
          amount: '100',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException when the asset is not supported', async () => {
      anchorConfigRepo.findOne.mockResolvedValue(
        makeAnchorConfig({ supportedAssets: ['SRT'] }),
      );
      // Mock fetchStellarToml to avoid real HTTP
      jest.spyOn(service, 'fetchStellarToml').mockResolvedValue({
        TRANSFER_SERVER_SEP0024: 'https://anchor.example.com',
        WEB_AUTH_ENDPOINT: 'https://anchor.example.com/auth',
      });

      await expect(
        service.startWithdrawal('merchant-1', {
          anchorConfigId: 'cfg-1',
          assetCode: 'USDC',
          amount: '100',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('stores the withdrawal record and emits an event when the anchor responds', async () => {
      anchorConfigRepo.findOne.mockResolvedValue(makeAnchorConfig());

      jest.spyOn(service, 'fetchStellarToml').mockResolvedValue({
        TRANSFER_SERVER_SEP0024: 'https://anchor.example.com/sep24',
        WEB_AUTH_ENDPOINT: 'https://anchor.example.com/auth',
      });
      jest.spyOn(service, 'authenticateSep10').mockResolvedValue('fake-jwt');

      // Spy on the private HTTP call via global fetch
      const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => ({
          type: 'interactive_customer_info_needed',
          url: 'https://anchor.example.com/interactive?token=xyz',
          id: 'anchor-tx-id-123',
        }),
      } as Response);

      const withdrawal: AnchorWithdrawal = {
        id: 'wd-1',
        merchantId: 'merchant-1',
        anchorConfigId: 'cfg-1',
        anchorTransactionId: 'anchor-tx-id-123',
        assetCode: 'USDC',
        amount: '100',
        status: AnchorWithdrawalStatus.PENDING_USER,
        interactiveUrl: 'https://anchor.example.com/interactive?token=xyz',
        withdrawAnchorAccount: null,
        withdrawMemo: null,
        withdrawMemoType: null,
        stellarTransactionHash: null,
        failureReason: null,
        anchorConfig: makeAnchorConfig(),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      withdrawalRepo.create.mockReturnValue(withdrawal);
      withdrawalRepo.save.mockResolvedValue(withdrawal);

      const result = await service.startWithdrawal('merchant-1', {
        anchorConfigId: 'cfg-1',
        assetCode: 'USDC',
        amount: '100',
      });

      expect(result.anchorTransactionId).toBe('anchor-tx-id-123');
      expect(result.interactiveUrl).toContain('interactive');
      expect(eventsService.emit).toHaveBeenCalledWith(
        'merchant-1',
        'anchor.withdrawal.started',
        expect.objectContaining({ anchorTransactionId: 'anchor-tx-id-123' }),
      );

      fetchSpy.mockRestore();
    });
  });

  // ── findWithdrawal ────────────────────────────────────────────────────────

  describe('findWithdrawal()', () => {
    it('throws NotFoundException when record is missing', async () => {
      withdrawalRepo.findOne.mockResolvedValue(null);
      await expect(service.findWithdrawal('merchant-1', 'missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ── applyAnchorStatus ─────────────────────────────────────────────────────

  describe('applyAnchorStatus() — via syncWithdrawalStatus()', () => {
    it('fires a webhook when the status transitions to COMPLETED', async () => {
      const withdrawal: AnchorWithdrawal = {
        id: 'wd-1',
        merchantId: 'merchant-1',
        anchorConfigId: 'cfg-1',
        anchorTransactionId: 'anchor-tx-123',
        assetCode: 'USDC',
        amount: '100',
        status: AnchorWithdrawalStatus.PENDING_ANCHOR,
        interactiveUrl: null,
        withdrawAnchorAccount: null,
        withdrawMemo: null,
        withdrawMemoType: null,
        stellarTransactionHash: null,
        failureReason: null,
        anchorConfig: makeAnchorConfig(),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      jest.spyOn(service, 'fetchStellarToml').mockResolvedValue({
        TRANSFER_SERVER_SEP0024: 'https://anchor.example.com/sep24',
        WEB_AUTH_ENDPOINT: 'https://anchor.example.com/auth',
      });
      jest.spyOn(service, 'authenticateSep10').mockResolvedValue('fake-jwt');

      const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => ({
          transaction: { status: 'completed' },
        }),
      } as Response);

      const updated = { ...withdrawal, status: AnchorWithdrawalStatus.COMPLETED };
      withdrawalRepo.save.mockResolvedValue(updated);

      await service.syncWithdrawalStatus(withdrawal);

      expect(webhooksService.dispatchEventToMerchant).toHaveBeenCalledWith(
        'merchant-1',
        'anchor.withdrawal.status_changed',
        expect.objectContaining({ status: AnchorWithdrawalStatus.COMPLETED }),
      );

      fetchSpy.mockRestore();
    });
  });
});

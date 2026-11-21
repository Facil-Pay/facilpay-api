import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { SettlementsController } from './settlements.controller';
import { SettlementsService } from './settlements.service';
import { UpsertSettlementConfigDto } from './dto/upsert-settlement-config.dto';
import { GetSettlementsDto } from './dto/get-settlements.dto';
import { Response } from 'express';

describe('SettlementsController', () => {
  let controller: SettlementsController;
  let service: SettlementsService;

  const mockSettlementsService = {
    upsertConfig: jest.fn(),
    preview: jest.fn(),
    findMerchantSettlements: jest.fn(),
    getSettlementStatement: jest.fn(),
    findAdjustmentsForSettlement: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [SettlementsController],
      providers: [
        {
          provide: SettlementsService,
          useValue: mockSettlementsService,
        },
      ],
    }).compile();

    controller = module.get<SettlementsController>(SettlementsController);
    service = module.get<SettlementsService>(SettlementsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('upsertConfig', () => {
    it('should create or update settlement configuration', async () => {
      const mockRequest = {
        user: { id: 'user-123' },
      };

      const dto: UpsertSettlementConfigDto = {
        schedule: 'daily',
        minimumAmount: 100,
      } as UpsertSettlementConfigDto;

      const mockConfig = {
        id: 'config-123',
        merchantId: 'user-123',
        schedule: 'daily',
        minimumAmount: 100,
        createdAt: new Date('2026-01-26T10:00:00.000Z'),
        updatedAt: new Date('2026-01-26T10:00:00.000Z'),
      };

      mockSettlementsService.upsertConfig.mockResolvedValue(mockConfig);

      const result = await controller.upsertConfig(dto, mockRequest);

      expect(service.upsertConfig).toHaveBeenCalledWith('user-123', dto);
      expect(result).toEqual(mockConfig);
    });
  });

  describe('preview', () => {
    it('should return settlement preview with breakdown per currency', async () => {
      const mockRequest = {
        user: { id: 'user-123' },
      };

      const mockPreview = {
        USD: {
          gross: 1500.0,
          fees: 45.0,
          refunds: 100.0,
          reserve: 50.0,
          net: 1305.0,
          estimatedDate: new Date('2026-01-27T00:00:00.000Z'),
        },
        EUR: {
          gross: 2000.0,
          fees: 60.0,
          refunds: 150.0,
          reserve: 75.0,
          net: 1715.0,
          estimatedDate: new Date('2026-01-27T00:00:00.000Z'),
        },
      };

      mockSettlementsService.preview.mockResolvedValue(mockPreview);

      const result = await controller.preview(mockRequest);

      expect(service.preview).toHaveBeenCalledWith('user-123');
      expect(result).toEqual(mockPreview);
      expect(result.USD.net).toBe(1305.0);
      expect(result.EUR.net).toBe(1715.0);
    });
  });

  describe('findMerchantSettlements', () => {
    it('should return paginated settlement history', async () => {
      const mockRequest = {
        user: { id: 'user-123' },
      };

      const dto: GetSettlementsDto = {
        page: 1,
        limit: 20,
      } as GetSettlementsDto;

      const mockSettlements = {
        data: [
          {
            id: 'settlement-123',
            merchantId: 'user-123',
            currency: 'USD',
            totalAmount: 1305.0,
            transactionHash: '0xabc123...',
            status: 'completed',
            createdAt: new Date('2026-01-26T00:00:00.000Z'),
            completedAt: new Date('2026-01-26T10:00:00.000Z'),
          },
        ],
        total: 1,
        page: 1,
        limit: 20,
      };

      mockSettlementsService.findMerchantSettlements.mockResolvedValue(mockSettlements);

      const result = await controller.findMerchantSettlements(mockRequest, dto);

      expect(service.findMerchantSettlements).toHaveBeenCalledWith('user-123', dto);
      expect(result).toEqual(mockSettlements);
      expect(result.data).toHaveLength(1);
    });

    it('should return settlements with date filtering', async () => {
      const mockRequest = {
        user: { id: 'user-123' },
      };

      const dto: GetSettlementsDto = {
        from: new Date('2026-01-01'),
        to: new Date('2026-01-31'),
        page: 1,
        limit: 20,
      } as GetSettlementsDto;

      mockSettlementsService.findMerchantSettlements.mockResolvedValue({
        data: [],
        total: 0,
        page: 1,
        limit: 20,
      });

      await controller.findMerchantSettlements(mockRequest, dto);

      expect(service.findMerchantSettlements).toHaveBeenCalledWith('user-123', dto);
    });
  });

  describe('statement', () => {
    const settlementId = 'settlement-123';
    const mockStatement = {
      merchant: 'Test Merchant',
      settlement: {
        id: settlementId,
        currency: 'USD',
        totalAmount: 1305.0,
        transactionHash: '0xabc123...',
      },
      period: {
        from: new Date('2026-01-20T00:00:00.000Z'),
        to: new Date('2026-01-26T23:59:59.000Z'),
      },
      rows: [
        {
          paymentId: 'pay_123',
          reference: 'ORDER-001',
          gross: 100.0,
          fee: 3.0,
          net: 97.0,
          refunds: 0,
          adjustments: 0,
        },
        {
          paymentId: 'pay_456',
          reference: 'ORDER-002',
          gross: 250.0,
          fee: 7.5,
          net: 242.5,
          refunds: 0,
          adjustments: 0,
        },
      ],
      totals: {
        gross: 350.0,
        fee: 10.5,
        net: 339.5,
        refunds: 0,
        adjustments: 0,
      },
    };

    it('should download CSV settlement statement', async () => {
      const mockRequest = {
        user: { id: 'user-123', roles: [] },
      };

      const mockResponse = {
        setHeader: jest.fn(),
        send: jest.fn(),
      } as unknown as Response;

      mockSettlementsService.getSettlementStatement.mockResolvedValue(mockStatement);

      await controller.statement(settlementId, 'csv', mockRequest, mockResponse);

      expect(service.getSettlementStatement).toHaveBeenCalledWith(
        settlementId,
        'user-123',
        false,
      );
      expect(mockResponse.setHeader).toHaveBeenCalledWith('Content-Type', 'text/csv');
      expect(mockResponse.setHeader).toHaveBeenCalledWith(
        'Content-Disposition',
        `attachment; filename="settlement-${settlementId}.csv"`,
      );
      expect(mockResponse.send).toHaveBeenCalled();
    });

    it('should download PDF settlement statement', async () => {
      const mockRequest = {
        user: { id: 'user-123', roles: [] },
      };

      const mockResponse = {
        setHeader: jest.fn(),
      } as unknown as Response;

      mockSettlementsService.getSettlementStatement.mockResolvedValue(mockStatement);

      await controller.statement(settlementId, 'pdf', mockRequest, mockResponse);

      expect(service.getSettlementStatement).toHaveBeenCalledWith(
        settlementId,
        'user-123',
        false,
      );
      expect(mockResponse.setHeader).toHaveBeenCalledWith('Content-Type', 'application/pdf');
      expect(mockResponse.setHeader).toHaveBeenCalledWith(
        'Content-Disposition',
        `attachment; filename="settlement-${settlementId}.pdf"`,
      );
    });

    it('should throw BadRequestException for invalid format', async () => {
      const mockRequest = {
        user: { id: 'user-123', roles: [] },
      };

      const mockResponse = {} as Response;

      await expect(
        controller.statement(settlementId, 'invalid', mockRequest, mockResponse),
      ).rejects.toThrow(BadRequestException);
    });

    it('should allow admin to access any settlement statement', async () => {
      const mockRequest = {
        user: { id: 'admin-123', roles: ['admin'] },
      };

      const mockResponse = {
        setHeader: jest.fn(),
        send: jest.fn(),
      } as unknown as Response;

      mockSettlementsService.getSettlementStatement.mockResolvedValue(mockStatement);

      await controller.statement(settlementId, 'csv', mockRequest, mockResponse);

      expect(service.getSettlementStatement).toHaveBeenCalledWith(
        settlementId,
        'admin-123',
        true,
      );
    });
  });

  describe('findAdjustments', () => {
    it('should return post-settlement adjustments', async () => {
      const settlementId = 'settlement-123';
      const mockRequest = {
        user: { id: 'user-123' },
      };

      const mockAdjustments = [
        {
          id: 'adjustment-1',
          settlementId,
          paymentId: 'pay_789',
          type: 'refund',
          amount: -50.0,
          currency: 'USD',
          reason: 'Customer refund issued after settlement',
          createdAt: new Date('2026-01-27T10:00:00.000Z'),
        },
        {
          id: 'adjustment-2',
          settlementId,
          paymentId: 'pay_890',
          type: 'chargeback',
          amount: -100.0,
          currency: 'USD',
          reason: 'Chargeback received',
          createdAt: new Date('2026-01-28T10:00:00.000Z'),
        },
      ];

      mockSettlementsService.findAdjustmentsForSettlement.mockResolvedValue(mockAdjustments);

      const result = await controller.findAdjustments(settlementId, mockRequest);

      expect(service.findAdjustmentsForSettlement).toHaveBeenCalledWith(
        'user-123',
        settlementId,
      );
      expect(result).toEqual(mockAdjustments);
      expect(result).toHaveLength(2);
    });
  });
});

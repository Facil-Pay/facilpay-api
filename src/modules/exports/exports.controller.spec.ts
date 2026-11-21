import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { ExportsController } from './exports.controller';
import { ExportsService } from './exports.service';
import { CreateExportDto } from './dto/create-export.dto';
import { Response } from 'express';
import { Readable } from 'stream';

describe('ExportsController', () => {
  let controller: ExportsController;
  let service: ExportsService;

  const mockExportsService = {
    createExport: jest.fn(),
    getExport: jest.fn(),
    buildDownloadUrl: jest.fn(),
    openDownload: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ExportsController],
      providers: [
        {
          provide: ExportsService,
          useValue: mockExportsService,
        },
      ],
    }).compile();

    controller = module.get<ExportsController>(ExportsController);
    service = module.get<ExportsService>(ExportsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('create', () => {
    it('should create an export job and return job details', async () => {
      const mockRequest = {
        user: { id: 'user-123' },
      };

      const dto: CreateExportDto = {
        resource: 'payments',
        format: 'csv',
        filters: {},
        from: new Date('2026-01-01'),
        to: new Date('2026-01-31'),
      } as CreateExportDto;

      const mockJob = {
        id: 'export-job-123',
        status: 'pending',
        type: 'payments',
        format: 'csv',
        createdAt: new Date('2026-01-26T10:00:00.000Z'),
      };

      mockExportsService.createExport.mockResolvedValue(mockJob);

      const result = await controller.create(mockRequest, dto);

      expect(result).toEqual({
        id: mockJob.id,
        status: mockJob.status,
        type: mockJob.type,
        format: mockJob.format,
        createdAt: mockJob.createdAt,
      });

      expect(service.createExport).toHaveBeenCalledWith({
        type: dto.resource,
        format: dto.format,
        filters: {
          from: dto.from,
          to: dto.to,
          status: dto.status,
          currency: dto.currency,
        },
        ownerId: 'user-123',
      });
    });

    it('should throw UnauthorizedException when user is not authenticated', async () => {
      const mockRequest = {};
      const dto: CreateExportDto = {
        resource: 'payments',
        format: 'csv',
      } as CreateExportDto;

      await expect(controller.create(mockRequest, dto)).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('status', () => {
    it('should return pending export job status', async () => {
      const mockRequest = {
        user: { id: 'user-123' },
      };

      const mockJob = {
        id: 'export-job-123',
        status: 'pending',
        type: 'payments',
        format: 'csv',
        error: null,
        createdAt: new Date('2026-01-26T10:00:00.000Z'),
        updatedAt: new Date('2026-01-26T10:00:00.000Z'),
        expiresAt: null,
      };

      mockExportsService.getExport.mockResolvedValue(mockJob);

      const result = await controller.status(mockRequest, 'export-job-123');

      expect(result).toEqual({
        id: mockJob.id,
        status: mockJob.status,
        type: mockJob.type,
        format: mockJob.format,
        error: null,
        createdAt: mockJob.createdAt,
        completedAt: null,
        expiresAt: null,
        downloadUrl: null,
      });

      expect(service.getExport).toHaveBeenCalledWith('export-job-123', 'user-123');
    });

    it('should return completed export job with download URL', async () => {
      const mockRequest = {
        user: { id: 'user-123' },
      };

      const mockJob = {
        id: 'export-job-123',
        status: 'completed',
        type: 'payments',
        format: 'csv',
        error: null,
        createdAt: new Date('2026-01-26T10:00:00.000Z'),
        updatedAt: new Date('2026-01-26T10:05:00.000Z'),
        expiresAt: new Date('2026-01-27T10:00:00.000Z'),
      };

      mockExportsService.getExport.mockResolvedValue(mockJob);
      mockExportsService.buildDownloadUrl.mockReturnValue(
        '/v1/exports/export-job-123/download?token=abc&expires=123456',
      );

      const result = await controller.status(mockRequest, 'export-job-123');

      expect(result.status).toBe('completed');
      expect(result.completedAt).toEqual(mockJob.updatedAt);
      expect(result.downloadUrl).toBe(
        '/v1/exports/export-job-123/download?token=abc&expires=123456',
      );
      expect(service.buildDownloadUrl).toHaveBeenCalledWith('export-job-123', 'user-123');
    });

    it('should return failed export job with error message', async () => {
      const mockRequest = {
        user: { id: 'user-123' },
      };

      const mockJob = {
        id: 'export-job-123',
        status: 'failed',
        type: 'payments',
        format: 'csv',
        error: 'Database connection timeout',
        createdAt: new Date('2026-01-26T10:00:00.000Z'),
        updatedAt: new Date('2026-01-26T10:02:00.000Z'),
        expiresAt: null,
      };

      mockExportsService.getExport.mockResolvedValue(mockJob);

      const result = await controller.status(mockRequest, 'export-job-123');

      expect(result.status).toBe('failed');
      expect(result.error).toBe('Database connection timeout');
      expect(result.downloadUrl).toBeNull();
    });

    it('should throw UnauthorizedException when user is not authenticated', async () => {
      const mockRequest = {};

      await expect(controller.status(mockRequest, 'export-job-123')).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('download', () => {
    it('should stream the export file to the response', async () => {
      const mockRequest = {
        user: { id: 'user-123' },
      };

      const mockStream = new Readable();
      mockStream.push('payment_id,amount,status\n');
      mockStream.push('pay_123,100.00,completed\n');
      mockStream.push(null);

      const mockResponse = {
        setHeader: jest.fn(),
        pipe: jest.fn(),
      } as unknown as Response;

      mockStream.pipe = jest.fn().mockReturnValue(mockResponse);

      mockExportsService.openDownload.mockResolvedValue({
        stream: mockStream,
        filename: 'payments-export-2026-01-26.csv',
        contentType: 'text/csv',
      });

      await controller.download(
        mockRequest,
        'export-job-123',
        'signed-token-abc',
        '1706256000',
        mockResponse,
      );

      expect(service.openDownload).toHaveBeenCalledWith(
        'user-123',
        'export-job-123',
        1706256000,
        'signed-token-abc',
      );

      expect(mockResponse.setHeader).toHaveBeenCalledWith('Content-Type', 'text/csv');
      expect(mockResponse.setHeader).toHaveBeenCalledWith(
        'Content-Disposition',
        'attachment; filename="payments-export-2026-01-26.csv"',
      );
      expect(mockStream.pipe).toHaveBeenCalledWith(mockResponse);
    });

    it('should throw UnauthorizedException when user is not authenticated', async () => {
      const mockRequest = {};
      const mockResponse = {} as Response;

      await expect(
        controller.download(mockRequest, 'export-job-123', 'token', '123', mockResponse),
      ).rejects.toThrow(UnauthorizedException);
    });
  });
});

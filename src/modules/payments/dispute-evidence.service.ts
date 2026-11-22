import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as fs from 'fs';
import * as path from 'path';
import { DisputeEvidence } from './dispute-evidence.entity';
import { Dispute, DisputeStatus } from './dispute.entity';
import { AppLogger } from '../logger/logger.service';
import { Logger } from 'pino';

const ALLOWED_MIME_TYPES = ['application/pdf', 'image/png', 'image/jpeg'];
const MAX_FILES_PER_DISPUTE = 10;
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB
const UPLOADS_BASE = path.join(process.cwd(), 'uploads', 'disputes');

function detectMimeByMagicBytes(buf: Buffer): string | null {
  if (buf.length < 4) return null;
  // PDF: %PDF
  if (buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46) {
    return 'application/pdf';
  }
  // PNG: \x89PNG
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return 'image/png';
  }
  // JPEG: \xFF\xD8\xFF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return 'image/jpeg';
  }
  return null;
}

@Injectable()
export class DisputeEvidenceService {
  private readonly logger: Logger;

  constructor(
    @InjectRepository(DisputeEvidence)
    private readonly evidenceRepository: Repository<DisputeEvidence>,
    @InjectRepository(Dispute)
    private readonly disputeRepository: Repository<Dispute>,
    appLogger: AppLogger,
  ) {
    this.logger = appLogger.child({ module: DisputeEvidenceService.name });
  }

  async upload(
    disputeId: string,
    file: Express.Multer.File,
    uploadedBy?: string,
  ): Promise<DisputeEvidence> {
    const dispute = await this.disputeRepository.findOneBy({ id: disputeId });
    if (!dispute) {
      throw new NotFoundException(`Dispute with ID ${disputeId} not found`);
    }

    const terminalStatuses: DisputeStatus[] = [DisputeStatus.RESOLVED, DisputeStatus.CLOSED];
    if (terminalStatuses.includes(dispute.status)) {
      throw new ConflictException(
        `Cannot add evidence to a dispute with status '${dispute.status}'`,
      );
    }

    if (file.size > MAX_FILE_SIZE_BYTES) {
      throw new BadRequestException(
        `File size ${file.size} bytes exceeds the 10 MB limit`,
      );
    }

    const detectedMime = detectMimeByMagicBytes(file.buffer);
    if (!detectedMime || !ALLOWED_MIME_TYPES.includes(detectedMime)) {
      throw new BadRequestException(
        'Unsupported file type. Only PDF, PNG and JPEG files are allowed',
      );
    }

    const existingCount = await this.evidenceRepository.count({
      where: { disputeId },
    });
    if (existingCount >= MAX_FILES_PER_DISPUTE) {
      throw new ConflictException(
        `Dispute has reached the maximum of ${MAX_FILES_PER_DISPUTE} evidence files`,
      );
    }

    const disputeDir = path.join(UPLOADS_BASE, disputeId);
    fs.mkdirSync(disputeDir, { recursive: true });
    const safeFileName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    const storageKey = path.join(disputeId, `${Date.now()}-${safeFileName}`);
    fs.writeFileSync(path.join(UPLOADS_BASE, storageKey), file.buffer);

    const evidence = this.evidenceRepository.create({
      disputeId,
      uploadedBy: uploadedBy ?? null,
      fileName: file.originalname,
      mimeType: detectedMime,
      sizeBytes: file.size,
      storageKey,
    });
    const saved = await this.evidenceRepository.save(evidence);
    this.logger.info(`Evidence uploaded: ${saved.id} for dispute ${disputeId}`);
    return saved;
  }

  async list(disputeId: string): Promise<DisputeEvidence[]> {
    const dispute = await this.disputeRepository.findOneBy({ id: disputeId });
    if (!dispute) {
      throw new NotFoundException(`Dispute with ID ${disputeId} not found`);
    }
    return this.evidenceRepository.find({
      where: { disputeId },
      order: { createdAt: 'ASC' },
    });
  }

  async download(
    disputeId: string,
    evidenceId: string,
  ): Promise<{ buffer: Buffer; mimeType: string; fileName: string }> {
    const evidence = await this.evidenceRepository.findOneBy({
      id: evidenceId,
      disputeId,
    });
    if (!evidence) {
      throw new NotFoundException(`Evidence with ID ${evidenceId} not found for dispute ${disputeId}`);
    }

    const fullPath = path.join(UPLOADS_BASE, evidence.storageKey);
    if (!fs.existsSync(fullPath)) {
      this.logger.error(
        `Evidence file missing from disk: ${fullPath} (evidenceId: ${evidenceId})`,
      );
      throw new NotFoundException('Evidence file is no longer available');
    }

    return {
      buffer: fs.readFileSync(fullPath),
      mimeType: evidence.mimeType,
      fileName: evidence.fileName,
    };
  }
}
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { DisputeEvidenceService } from './dispute-evidence.service';
import { DisputeEvidence } from './dispute-evidence.entity';
import { Dispute, DisputeStatus } from './dispute.entity';
import { AppLogger } from '../logger/logger.service';

const PDF_MAGIC = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e]); // %PDF-1.
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
const INVALID_MAGIC = Buffer.from([0x47, 0x49, 0x46, 0x38]); // GIF

const mockDispute = (status: DisputeStatus = DisputeStatus.OPEN): Dispute =>
  ({ id: 'dispute-uuid', status } as Dispute);

const mockFile = (buffer: Buffer, size?: number): Express.Multer.File => ({
  buffer,
  originalname: 'test.pdf',
  mimetype: 'application/pdf',
  size: size ?? buffer.length,
  fieldname: 'file',
  encoding: '7bit',
  destination: '',
  filename: '',
  path: '',
  stream: null as any,
});

describe('DisputeEvidenceService', () => {
  let service: DisputeEvidenceService;
  let evidenceRepo: { count: jest.Mock; create: jest.Mock; save: jest.Mock; find: jest.Mock; findOneBy: jest.Mock };
  let disputeRepo: { findOneBy: jest.Mock };
  let fsMocks: { mkdirSync: jest.SpyInstance; writeFileSync: jest.SpyInstance; existsSync: jest.SpyInstance; readFileSync: jest.SpyInstance };

  beforeEach(async () => {
    evidenceRepo = {
      count: jest.fn(),
      create: jest.fn((v) => v),
      save: jest.fn((v) => ({ id: 'evidence-uuid', ...v })),
      find: jest.fn(),
      findOneBy: jest.fn(),
    };
    disputeRepo = { findOneBy: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DisputeEvidenceService,
        { provide: getRepositoryToken(DisputeEvidence), useValue: evidenceRepo },
        { provide: getRepositoryToken(Dispute), useValue: disputeRepo },
        {
          provide: AppLogger,
          useValue: { child: () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }) },
        },
      ],
    }).compile();

    service = module.get<DisputeEvidenceService>(DisputeEvidenceService);

    const fs = await import('fs');
    fsMocks = {
      mkdirSync: jest.spyOn(fs, 'mkdirSync').mockImplementation(() => undefined),
      writeFileSync: jest.spyOn(fs, 'writeFileSync').mockImplementation(() => undefined),
      existsSync: jest.spyOn(fs, 'existsSync').mockReturnValue(true),
      readFileSync: jest.spyOn(fs, 'readFileSync').mockReturnValue(PDF_MAGIC) as any,
    };
  });

  afterEach(() => jest.restoreAllMocks());

  describe('upload', () => {
    it('throws NotFoundException when dispute does not exist', async () => {
      disputeRepo.findOneBy.mockResolvedValue(null);
      await expect(service.upload('missing-id', mockFile(PDF_MAGIC))).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws ConflictException for resolved dispute', async () => {
      disputeRepo.findOneBy.mockResolvedValue(mockDispute(DisputeStatus.RESOLVED));
      await expect(service.upload('dispute-uuid', mockFile(PDF_MAGIC))).rejects.toBeInstanceOf(ConflictException);
    });

    it('throws ConflictException for closed dispute', async () => {
      disputeRepo.findOneBy.mockResolvedValue(mockDispute(DisputeStatus.CLOSED));
      await expect(service.upload('dispute-uuid', mockFile(PDF_MAGIC))).rejects.toBeInstanceOf(ConflictException);
    });

    it('throws BadRequestException when file exceeds 10 MB', async () => {
      disputeRepo.findOneBy.mockResolvedValue(mockDispute());
      const oversizedBuffer = Buffer.alloc(4);
      oversizedBuffer[0] = 0x25; oversizedBuffer[1] = 0x50; oversizedBuffer[2] = 0x44; oversizedBuffer[3] = 0x46;
      await expect(
        service.upload('dispute-uuid', mockFile(oversizedBuffer, 11 * 1024 * 1024)),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('throws BadRequestException for unsupported file type (magic bytes)', async () => {
      disputeRepo.findOneBy.mockResolvedValue(mockDispute());
      await expect(
        service.upload('dispute-uuid', mockFile(INVALID_MAGIC)),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('throws ConflictException when 10 files already uploaded', async () => {
      disputeRepo.findOneBy.mockResolvedValue(mockDispute());
      evidenceRepo.count.mockResolvedValue(10);
      await expect(
        service.upload('dispute-uuid', mockFile(PDF_MAGIC)),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('accepts PDF files validated by magic bytes', async () => {
      disputeRepo.findOneBy.mockResolvedValue(mockDispute());
      evidenceRepo.count.mockResolvedValue(0);
      const result = await service.upload('dispute-uuid', mockFile(PDF_MAGIC), 'user-123');
      expect(result.mimeType).toBe('application/pdf');
      expect(result.uploadedBy).toBe('user-123');
    });

    it('accepts PNG files validated by magic bytes', async () => {
      disputeRepo.findOneBy.mockResolvedValue(mockDispute());
      evidenceRepo.count.mockResolvedValue(0);
      const pngFile = { ...mockFile(PNG_MAGIC), originalname: 'image.png' };
      const result = await service.upload('dispute-uuid', pngFile);
      expect(result.mimeType).toBe('image/png');
    });

    it('accepts JPEG files validated by magic bytes', async () => {
      disputeRepo.findOneBy.mockResolvedValue(mockDispute());
      evidenceRepo.count.mockResolvedValue(0);
      const jpgFile = { ...mockFile(JPEG_MAGIC), originalname: 'photo.jpg' };
      const result = await service.upload('dispute-uuid', jpgFile);
      expect(result.mimeType).toBe('image/jpeg');
    });
  });

  describe('list', () => {
    it('throws NotFoundException when dispute does not exist', async () => {
      disputeRepo.findOneBy.mockResolvedValue(null);
      await expect(service.list('missing-id')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('returns evidence list sorted by createdAt ASC', async () => {
      disputeRepo.findOneBy.mockResolvedValue(mockDispute());
      evidenceRepo.find.mockResolvedValue([{ id: 'ev1' }, { id: 'ev2' }]);
      const result = await service.list('dispute-uuid');
      expect(result).toHaveLength(2);
      expect(evidenceRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({ order: { createdAt: 'ASC' } }),
      );
    });
  });

  describe('download', () => {
    it('throws NotFoundException when evidence does not exist', async () => {
      evidenceRepo.findOneBy.mockResolvedValue(null);
      await expect(service.download('dispute-uuid', 'missing-ev')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('returns buffer and metadata for existing evidence', async () => {
      evidenceRepo.findOneBy.mockResolvedValue({
        id: 'ev-uuid',
        storageKey: 'dispute-uuid/file.pdf',
        mimeType: 'application/pdf',
        fileName: 'receipt.pdf',
      });
      const result = await service.download('dispute-uuid', 'ev-uuid');
      expect(result.mimeType).toBe('application/pdf');
      expect(result.fileName).toBe('receipt.pdf');
    });
  });
});

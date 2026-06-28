import {
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { createHash, randomBytes } from 'crypto';
import { ApiKey, ApiKeyEnvironment, ApiKeyScope } from './api-key.entity';
import { CreateApiKeyDto } from './dto/create-api-key.dto';

@Injectable()
export class ApiKeysService {
  constructor(
    @InjectRepository(ApiKey)
    private readonly apiKeyRepository: Repository<ApiKey>,
  ) {}

  async create(
    userId: string,
    dto: CreateApiKeyDto,
  ): Promise<{ apiKey: ApiKey; plaintext: string }> {
    const environment = dto.environment ?? ApiKeyEnvironment.LIVE;
    const rawToken = randomBytes(32).toString('hex');
    const prefix = environment === ApiKeyEnvironment.LIVE ? 'fp_live_' : 'fp_test_';
    const plaintext = `${prefix}${rawToken}`;
    const keyHash = createHash('sha256').update(plaintext).digest('hex');
    const keyPrefix = plaintext.slice(0, 12);

    const apiKey = this.apiKeyRepository.create({
      name: dto.name,
      keyHash,
      keyPrefix,
      userId,
      scope: dto.scope ?? ApiKeyScope.READ,
      environment,
      expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
      lastUsedAt: null,
      isActive: true,
    });

    const saved = await this.apiKeyRepository.save(apiKey);
    return { apiKey: saved, plaintext };
  }

  async findAllForUser(userId: string): Promise<ApiKey[]> {
    return this.apiKeyRepository.find({
      where: { userId, isActive: true },
      order: { createdAt: 'DESC' },
    });
  }

  async revoke(id: string, userId: string): Promise<void> {
    const key = await this.apiKeyRepository.findOne({ where: { id, userId } });
    if (!key) {
      throw new NotFoundException(`API key with ID ${id} not found`);
    }
    key.isActive = false;
    await this.apiKeyRepository.save(key);
  }

  async validateKey(plaintext: string): Promise<ApiKey> {
    const keyHash = createHash('sha256').update(plaintext).digest('hex');
    const key = await this.apiKeyRepository.findOne({ where: { keyHash, isActive: true } });

    if (!key) {
      throw new UnauthorizedException('Invalid API key');
    }

    if (key.expiresAt && key.expiresAt < new Date()) {
      throw new UnauthorizedException('API key has expired');
    }

    key.lastUsedAt = new Date();
    await this.apiKeyRepository.save(key);

    return key;
  }
}

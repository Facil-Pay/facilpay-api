import { Injectable, ConflictException, UnprocessableEntityException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan } from 'typeorm';
import { createHash } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { IdempotencyKey } from './idempotency.entity';

@Injectable()
export class IdempotencyService {
  private readonly ttlHours: number;
  private readonly inProgressPlaceholder = { __in_progress: true };

  constructor(
    @InjectRepository(IdempotencyKey)
    private readonly idempotencyRepository: Repository<IdempotencyKey>,
    private readonly configService: ConfigService,
  ) {
    this.ttlHours = this.configService.get<number>('IDEMPOTENCY_TTL_HOURS', 24);
  }

  hashRequest(body: any): string {
    return createHash('sha256').update(JSON.stringify(body)).digest('hex');
  }

  async checkKey(key: string, requestBody: any): Promise<any | null> {
    const requestHash = this.hashRequest(requestBody);
    const existing = await this.idempotencyRepository.findOne({ where: { key } });

    if (!existing) return null;

    if (new Date() > existing.expiresAt) {
      await this.idempotencyRepository.delete({ key });
      return null;
    }

    if (existing.requestHash !== requestHash) {
      throw new UnprocessableEntityException(
        'Idempotency key reused with different request body',
      );
    }

    return existing.response;
  }

  async storeKey(key: string, requestBody: any, response: any): Promise<void> {
    const requestHash = this.hashRequest(requestBody);
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + this.ttlHours);

    const idempotencyKey = this.idempotencyRepository.create({
      key,
      requestHash,
      response,
      expiresAt,
    });

    await this.idempotencyRepository.save(idempotencyKey);
  }

  async checkOrClaimKey(key: string, requestBody: any): Promise<any | null> {
    // 1. Check if the key already exists
    const existing = await this.idempotencyRepository.findOne({ where: { key } });

    if (existing) {
      // 2. Check if expired
      if (new Date() > existing.expiresAt) {
        await this.idempotencyRepository.delete({ key });
        // deleted, now proceed to claim it below
      } else {
        // 3. Key is valid. Check request hash compatibility
        const requestHash = this.hashRequest(requestBody);
        if (existing.requestHash !== requestHash) {
          throw new UnprocessableEntityException(
            'Idempotency key reused with different request body',
          );
        }

        // 4. Check if request is still in progress
        if (existing.response && existing.response.__in_progress === true) {
          throw new ConflictException(
            'Another request with the same idempotency key is in progress',
          );
        }

        // 5. Return the cached response
        return existing.response;
      }
    }

    // 6. Attempt atomic insert/claim
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + this.ttlHours);
    const requestHash = this.hashRequest(requestBody);

    const idempotencyKey = this.idempotencyRepository.create({
      key,
      requestHash,
      response: this.inProgressPlaceholder,
      expiresAt,
    });

    try {
      await this.idempotencyRepository.insert(idempotencyKey);
    } catch (error) {
      // Unique constraint violation (race condition: another concurrent request inserted it first)
      return this.handleConflict(key, requestBody);
    }

    return null; // newly claimed
  }

  private async handleConflict(key: string, requestBody: any): Promise<any> {
    const existing = await this.idempotencyRepository.findOne({ where: { key } });
    if (!existing) {
      // Deleted/expired in the tiny window between insert failure and findOne.
      // Retry the check/claim.
      return this.checkOrClaimKey(key, requestBody);
    }

    if (new Date() > existing.expiresAt) {
      await this.idempotencyRepository.delete({ key });
      return this.checkOrClaimKey(key, requestBody);
    }

    const requestHash = this.hashRequest(requestBody);
    if (existing.requestHash !== requestHash) {
      throw new UnprocessableEntityException(
        'Idempotency key reused with different request body',
      );
    }

    if (existing.response && existing.response.__in_progress === true) {
      throw new ConflictException(
        'Another request with the same idempotency key is in progress',
      );
    }

    return existing.response;
  }

  async updateResponse(key: string, response: any): Promise<void> {
    await this.idempotencyRepository.update({ key }, { response });
  }

  async deleteKey(key: string): Promise<void> {
    await this.idempotencyRepository.delete({ key });
  }

  async cleanupExpired(): Promise<void> {
    await this.idempotencyRepository.delete({
      expiresAt: LessThan(new Date()),
    });
  }
}

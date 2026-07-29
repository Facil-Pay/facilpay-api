import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  GoneException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomBytes } from 'crypto';
import { PaymentLink } from './payment-link.entity';
import { CreatePaymentLinkDto } from './dto/create-payment-link.dto';
import { UpdatePaymentLinkDto } from './dto/update-payment-link.dto';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { PaginatedResult } from '../../common/interfaces/paginated-result.interface';

@Injectable()
export class PaymentLinksService {
  constructor(
    @InjectRepository(PaymentLink)
    private readonly repo: Repository<PaymentLink>,
  ) {}

  async create(dto: CreatePaymentLinkDto, merchantId: string): Promise<PaymentLink> {
    const token = randomBytes(16).toString('hex');
    const link = this.repo.create({
      ...dto,
      token,
      merchantId,
      expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
    });
    return this.repo.save(link);
  }

  async findByToken(token: string): Promise<PaymentLink> {
    const link = await this.repo.findOneBy({ token });
    if (!link) throw new NotFoundException('Payment link not found');
    if (!link.isActive) throw new GoneException('Payment link has been deactivated');
    if (link.expiresAt && link.expiresAt < new Date()) {
      throw new GoneException('Payment link has expired');
    }
    await this.repo.increment({ token }, 'views', 1);
    link.views += 1;
    return link;
  }

  async deactivate(id: string, merchantId: string): Promise<void> {
    const link = await this.repo.findOneBy({ id });
    if (!link) throw new NotFoundException('Payment link not found');
    if (link.merchantId !== merchantId) throw new ForbiddenException();
    link.isActive = false;
    await this.repo.save(link);
  }

  async findAllByMerchant(
    merchantId: string,
    pagination: PaginationDto,
  ): Promise<PaginatedResult<PaymentLink>> {
    const { page, limit, sortBy, order } = pagination;

    const allowedSortFields = ['createdAt', 'amount', 'views', 'completions', 'updatedAt'];
    const sortField = allowedSortFields.includes(sortBy) ? sortBy : 'createdAt';

    const [data, total] = await this.repo.findAndCount({
      where: { merchantId },
      order: { [sortField]: order || 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    return { data, total, page, limit };
  }

  async update(
    id: string,
    merchantId: string,
    dto: UpdatePaymentLinkDto,
  ): Promise<PaymentLink> {
    const link = await this.repo.findOneBy({ id });
    if (!link) throw new NotFoundException('Payment link not found');
    if (link.merchantId !== merchantId) throw new ForbiddenException();

    if (dto.amount !== undefined) link.amount = dto.amount;
    if (dto.currency !== undefined) link.currency = dto.currency;
    if (dto.description !== undefined) link.description = dto.description;
    if (dto.expiresAt !== undefined) {
      link.expiresAt = dto.expiresAt ? new Date(dto.expiresAt) : null;
    }

    return this.repo.save(link);
  }
}

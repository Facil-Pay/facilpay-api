import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Event } from '../events/entities/event.entity';
import { WEBHOOK_EVENT_TYPES } from './entities/webhook-endpoint.entity';
import { CURRENT_API_VERSION, getSerializer, isValidApiVersion } from './payload-serializers';

@Injectable()
export class HooksService {
  constructor(@InjectRepository(Event) private readonly events: Repository<Event>) {}

  async samples(merchantId: string, type: string, version = CURRENT_API_VERSION) {
    if (!(WEBHOOK_EVENT_TYPES as readonly string[]).includes(type)) throw new BadRequestException('Unknown event type');
    if (!isValidApiVersion(version)) throw new BadRequestException('Unsupported payload version');
    const events = await this.events.find({ where: { merchantId, type }, order: { createdAt: 'DESC', id: 'DESC' }, take: 20 });
    const serializer = getSerializer(version);
    // Empty merchants still get a deterministic trigger setup sample.
    if (!events.length) return [{ ...serializer.serialize(type, { id: `sample_${type}`, sample: true }, `sample_${type}`), id: `sample_${type}` }];
    return events.map((event) => ({ ...serializer.serialize(type, event.payload, event.id), id: event.id }));
  }
}

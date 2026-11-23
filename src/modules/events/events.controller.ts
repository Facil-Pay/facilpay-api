import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { EventsService } from './events.service';
import { Event } from './entities/event.entity';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '../users/user.entity';
import { RequireScope } from '../api-keys/decorators/require-scope.decorator';

@ApiTags('events')
@ApiBearerAuth('bearer')
@UseGuards(JwtAuthGuard)
@Controller('v1/events')
@RequireScope('events:read')
export class EventsController {
  constructor(private readonly eventsService: EventsService) {}

  @Get()
  @ApiOperation({
    summary: 'List events for the merchant',
    description: 'Returns paginated events with cursor-based pagination. Supports filtering by type and date range.',
  })
  @ApiQuery({ name: 'type', required: false, description: 'Filter by event type' })
  @ApiQuery({ name: 'from', required: false, description: 'Filter events after this date (ISO 8601)' })
  @ApiQuery({ name: 'to', required: false, description: 'Filter events before this date (ISO 8601)' })
  @ApiQuery({ name: 'cursor', required: false, description: 'Pagination cursor' })
  @ApiQuery({ name: 'limit', required: false, description: 'Number of results (default 20)' })
  findAll(
    @CurrentUser() user: User,
    @Query('type') type?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.eventsService.findAll(user.id, {
      type,
      from: from ? new Date(from) : undefined,
      to: to ? new Date(to) : undefined,
      cursor,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single event by ID' })
  findOne(@Param('id') id: string, @CurrentUser() user: User): Promise<Event> {
    return this.eventsService.findOne(id, user.id);
  }
}

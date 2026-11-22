import { Controller, Get, Param, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '../users/user.entity';
import { RequestLogsService } from './request-logs.service';
import { RequestLogsQueryDto } from './request-logs.dto';
import { RequestLog } from './request-log.entity';
@ApiTags('request-logs')
@ApiBearerAuth('bearer')
@ApiUnauthorizedResponse()
@UseGuards(JwtAuthGuard)
@Controller('v1/request-logs')
export class RequestLogsController {
  constructor(private readonly logs: RequestLogsService) {}
  @Get() @ApiOperation({ summary: 'Query redacted API request logs from the last 30 days' })
  @ApiOkResponse({ description: 'Paginated request logs: data, total, page, limit' })
  list(@CurrentUser() user: User, @Query() query: RequestLogsQueryDto) { return this.logs.list(user.id, query); }
  @Get(':id') @ApiOperation({ summary: 'Get one redacted API request log' })
  @ApiOkResponse({ type: RequestLog }) @ApiNotFoundResponse()
  get(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string) { return this.logs.get(user.id, id); }
}

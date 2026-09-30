import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../../common/constants/roles';
import { AdminMetricsService } from './admin-metrics.service';
import { GetMetricsDto } from './dto/get-metrics.dto';

@ApiTags('admin')
@ApiBearerAuth('bearer')
@Controller('v1/admin/metrics')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminMetricsController {
  constructor(private readonly metricsService: AdminMetricsService) {}

  @Get()
  @ApiOperation({ summary: 'Get platform metrics' })
  async getMetrics(@Query() query: GetMetricsDto) {
    return this.metricsService.getMetrics(query);
  }
}

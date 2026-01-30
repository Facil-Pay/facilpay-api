import { Controller, Get } from '@nestjs/common';
import { HealthService } from './health.service';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  @ApiOperation({
    summary: 'Health check',
    description:
      'Returns API health status and verifies database connectivity (runs a lightweight `SELECT 1`).',
  })
  @ApiOkResponse({
    description: 'Health status.',
    schema: {
      example: {
        status: 'ok',
        timestamp: '2026-01-26T10:00:00.000Z',
        services: {
          database: {
            connected: true,
            message: 'Database connection is healthy',
          },
        },
      },
    },
  })
  async health() {
    return this.healthService.check();
  }
}

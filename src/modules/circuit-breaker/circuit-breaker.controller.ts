import { Controller, Get, Post, Param, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiOkResponse, ApiParam } from '@nestjs/swagger';
import { CircuitBreakerService } from './circuit-breaker.service';

@ApiTags('circuit-breaker')
@Controller('v1/circuit-breaker')
export class CircuitBreakerController {
  constructor(private readonly cb: CircuitBreakerService) {}

  @Get()
  @ApiOperation({ summary: 'Get all circuit breaker states' })
  @ApiOkResponse({ description: 'Map of circuit name to current state.' })
  getAllStates() {
    return this.cb.getAllStates();
  }

  @Get(':name')
  @ApiOperation({ summary: 'Get state of a named circuit' })
  @ApiParam({ name: 'name', example: 'stellar-horizon' })
  @ApiOkResponse({ description: 'Circuit state.' })
  getState(@Param('name') name: string) {
    return this.cb.getState(name) ?? { state: 'UNKNOWN' };
  }

  @Post(':name/reset')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Manually reset a named circuit to CLOSED' })
  @ApiParam({ name: 'name', example: 'stellar-horizon' })
  @ApiOkResponse({ description: 'Circuit reset.' })
  reset(@Param('name') name: string) {
    this.cb.reset(name);
    return { message: `Circuit '${name}' reset to CLOSED` };
  }
}

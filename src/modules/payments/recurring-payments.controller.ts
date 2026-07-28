import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Request,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiParam,
  ApiNotFoundResponse,
  ApiConflictResponse,
} from '@nestjs/swagger';
import { RecurringPaymentsService } from './recurring-payments.service';
import { CreateRecurringPaymentDto } from './dto/create-recurring-payment.dto';
import { RecurringPayment } from './recurring-payment.entity';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@ApiTags('recurring-payments')
@Controller('v1/recurring-payments')
@UseGuards(JwtAuthGuard)
export class RecurringPaymentsController {
  constructor(private readonly service: RecurringPaymentsService) {}

  @Post()
  @ApiBearerAuth('bearer')
  @ApiOperation({
    summary: 'Create a recurring payment plan',
    description:
      'Creates a plan that automatically generates a new payment on the configured interval (daily, weekly, monthly), reusing the normal payment creation and webhook flow for each charge.',
  })
  @ApiCreatedResponse({
    description: 'Recurring payment plan created.',
    type: RecurringPayment,
  })
  create(@Body() dto: CreateRecurringPaymentDto, @Request() req: any) {
    return this.service.create(dto, req.user.id);
  }

  @Get()
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'List recurring payment plans' })
  @ApiOkResponse({
    description: 'Recurring payment plans owned by the authenticated user.',
    type: [RecurringPayment],
  })
  findAll(@Request() req: any) {
    return this.service.findAll(req.user.id);
  }

  @Get(':id')
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'Get a recurring payment plan' })
  @ApiParam({ name: 'id', description: 'Recurring payment plan UUID' })
  @ApiOkResponse({ description: 'Recurring payment plan.', type: RecurringPayment })
  @ApiNotFoundResponse({ description: 'Plan not found.' })
  findOne(@Param('id') id: string, @Request() req: any) {
    return this.service.findOne(id, req.user.id);
  }

  @Post(':id/pause')
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'Pause a recurring payment plan' })
  @ApiParam({ name: 'id', description: 'Recurring payment plan UUID' })
  @ApiOkResponse({ description: 'Plan paused.', type: RecurringPayment })
  @ApiNotFoundResponse({ description: 'Plan not found.' })
  @ApiConflictResponse({ description: 'Plan is not active.' })
  pause(@Param('id') id: string, @Request() req: any) {
    return this.service.pause(id, req.user.id);
  }

  @Post(':id/resume')
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'Resume a paused recurring payment plan' })
  @ApiParam({ name: 'id', description: 'Recurring payment plan UUID' })
  @ApiOkResponse({ description: 'Plan resumed.', type: RecurringPayment })
  @ApiNotFoundResponse({ description: 'Plan not found.' })
  @ApiConflictResponse({ description: 'Plan is not paused.' })
  resume(@Param('id') id: string, @Request() req: any) {
    return this.service.resume(id, req.user.id);
  }

  @Post(':id/cancel')
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'Cancel a recurring payment plan' })
  @ApiParam({ name: 'id', description: 'Recurring payment plan UUID' })
  @ApiOkResponse({ description: 'Plan cancelled.', type: RecurringPayment })
  @ApiNotFoundResponse({ description: 'Plan not found.' })
  @ApiConflictResponse({ description: 'Plan is already cancelled.' })
  cancel(@Param('id') id: string, @Request() req: any) {
    return this.service.cancel(id, req.user.id);
  }
}

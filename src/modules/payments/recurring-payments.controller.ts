import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
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
  ApiQuery,
  ApiNotFoundResponse,
  ApiConflictResponse,
} from '@nestjs/swagger';
import { RecurringPaymentsService } from './recurring-payments.service';
import { CreateRecurringPaymentDto } from './dto/create-recurring-payment.dto';
import {
  PreviewRecurringPaymentProrationDto,
  UpdateRecurringPaymentDto,
} from './dto/update-recurring-payment.dto';
import { RecurringPayment } from './recurring-payment.entity';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Public } from '../auth/decorators/public.decorator';
import { PaginationDto } from '../../common/dto/pagination.dto';

@ApiTags('recurring-payments')
@Controller('v1/recurring-payments')
@UseGuards(JwtAuthGuard)
export class RecurringPaymentsController {
  constructor(private readonly service: RecurringPaymentsService) {}

  @Get('public/cancel')
  @Public()
  @ApiOperation({
    summary: 'Review a payer cancellation request',
    description: 'Validates a signed cancellation link without changing the plan. Confirm by submitting the token to POST /public/cancel.',
  })
  @ApiQuery({ name: 'token', required: true, type: String })
  @ApiOkResponse({ description: 'Plan details for the confirmation step.' })
  getPayerCancellation(@Query('token') token: string) {
    return this.service.getPayerCancellation(token);
  }

  @Post('public/cancel')
  @Public()
  @ApiOperation({
    summary: 'Confirm and cancel a recurring plan as its payer',
    description: 'Consumes a valid, unexpired cancellation token and cancels the plan once.',
  })
  @ApiOkResponse({ description: 'Plan cancelled.' })
  cancelAsPayer(@Body('token') token: string) {
    return this.service.cancelWithToken(token);
  }

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

  @Get(':id/charges')
  @ApiBearerAuth('bearer')
  @ApiOperation({
    summary: 'List recurring payment charge attempts',
    description:
      'Returns charge attempts for a plan in chronological order, including failed attempts and their failure reasons.',
  })
  @ApiParam({ name: 'id', description: 'Recurring payment plan UUID' })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 20 })
  @ApiOkResponse({ description: 'Paginated recurring payment charge history.' })
  @ApiNotFoundResponse({ description: 'Plan not found.' })
  findCharges(
    @Param('id') id: string,
    @Query() pagination: PaginationDto,
    @Request() req: any,
  ) {
    return this.service.findCharges(id, req.user.id, pagination);
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

  @Post(':id/proration-preview')
  @ApiBearerAuth('bearer')
  @ApiOperation({
    summary: 'Preview proration for a recurring payment amount change',
  })
  @ApiParam({ name: 'id', description: 'Recurring payment plan UUID' })
  @ApiOkResponse({ description: 'Proration preview for the current period.' })
  @ApiNotFoundResponse({ description: 'Plan not found.' })
  previewProration(
    @Param('id') id: string,
    @Body() dto: PreviewRecurringPaymentProrationDto,
    @Request() req: any,
  ) {
    return this.service.previewProration(id, req.user.id, dto.amount);
  }

  @Patch(':id')
  @ApiBearerAuth('bearer')
  @ApiOperation({
    summary: 'Update a recurring payment plan',
    description:
      'Updates amount, interval, and/or description on a plan owned by the caller. Changes apply to future scheduled runs only; already-created payments are unaffected.',
  })
  @ApiParam({ name: 'id', description: 'Recurring payment plan UUID' })
  @ApiOkResponse({ description: 'Plan updated.', type: RecurringPayment })
  @ApiNotFoundResponse({ description: 'Plan not found.' })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateRecurringPaymentDto,
    @Request() req: any,
  ) {
    return this.service.update(id, req.user.id, dto);
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

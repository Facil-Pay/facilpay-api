import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBody,
  ApiParam,
  ApiHeader,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiBadRequestResponse,
  ApiNotFoundResponse,
  ApiUnauthorizedResponse,
  ApiInternalServerErrorResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { PaymentsService } from './payments.service';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { PaymentWebhookDto } from './dto/payment-webhook.dto';
import { Payment } from './payment.entity';
import { WebhookThrottle } from '../throttler/throttler.decorator';
import { WebhookGuard } from './webhook.guard';

@ApiTags('payments')
@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post()
  @ApiOperation({
    summary: 'Create a payment',
    description: 'Initiates a new payment record with PENDING status.',
  })
  @ApiBody({ type: CreatePaymentDto })
  @ApiCreatedResponse({
    description: 'Payment created successfully.',
    type: Payment,
    schema: {
      example: {
        id: '123e4567-e89b-12d3-a456-426614174000',
        amount: 100.5,
        currency: 'USD',
        status: 'PENDING',
        description: 'Payment for order #12345',
        externalReference: null,
        createdAt: '2026-01-26T10:00:00.000Z',
        updatedAt: '2026-01-26T10:00:00.000Z',
      },
    },
  })
  @ApiBadRequestResponse({
    description: 'Validation failed (invalid amount, missing currency, etc.).',
    schema: {
      example: {
        statusCode: 400,
        message: ['Amount must be a positive number', 'Currency is required'],
        error: 'Bad Request',
      },
    },
  })
  @ApiUnprocessableEntityResponse({
    description: 'Unprocessable entity.',
    schema: {
      example: { statusCode: 422, message: 'Unprocessable Entity' },
    },
  })
  @ApiInternalServerErrorResponse({
    description: 'Internal server error.',
    schema: {
      example: { statusCode: 500, message: 'Internal server error' },
    },
  })
  create(@Body() createPaymentDto: CreatePaymentDto) {
    return this.paymentsService.create(createPaymentDto);
  }

  @Get()
  @ApiOperation({
    summary: 'List all payments',
    description:
      'Returns all payments ordered by creation date (newest first).',
  })
  @ApiOkResponse({
    description: 'List of payments.',
    type: [Payment],
  })
  @ApiInternalServerErrorResponse({
    description: 'Internal server error.',
    schema: {
      example: { statusCode: 500, message: 'Internal server error' },
    },
  })
  findAll() {
    return this.paymentsService.findAll();
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get a payment by ID',
    description: 'Returns a single payment by its UUID.',
  })
  @ApiParam({
    name: 'id',
    description: 'Payment UUID',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @ApiOkResponse({
    description: 'Payment found.',
    type: Payment,
  })
  @ApiNotFoundResponse({
    description: 'Payment not found.',
    schema: {
      example: {
        statusCode: 404,
        message:
          'Payment with ID 123e4567-e89b-12d3-a456-426614174000 not found',
        error: 'Not Found',
      },
    },
  })
  @ApiInternalServerErrorResponse({
    description: 'Internal server error.',
    schema: {
      example: { statusCode: 500, message: 'Internal server error' },
    },
  })
  findOne(@Param('id') id: string) {
    return this.paymentsService.findOne(id);
  }

  @WebhookThrottle()
  @UseGuards(WebhookGuard)
  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Handle payment webhook',
    description:
      'Updates payment status from an external provider. Requires a valid HMAC-SHA256 signature in the X-Signature header computed over the raw JSON body using the configured WEBHOOK_SECRET.',
  })
  @ApiHeader({
    name: 'X-Signature',
    description:
      'HMAC-SHA256 hex digest of the raw request body, keyed with WEBHOOK_SECRET',
    required: true,
    example: 'a1b2c3d4e5f6...',
  })
  @ApiBody({ type: PaymentWebhookDto })
  @ApiOkResponse({
    description: 'Webhook processed successfully.',
    type: Payment,
    schema: {
      example: {
        id: '123e4567-e89b-12d3-a456-426614174000',
        amount: 100.5,
        currency: 'USD',
        status: 'COMPLETED',
        externalReference: 'ext_ref_12345',
        description: 'Payment for order #12345',
        createdAt: '2026-01-26T10:00:00.000Z',
        updatedAt: '2026-01-26T10:05:00.000Z',
      },
    },
  })
  @ApiBadRequestResponse({
    description: 'Missing or invalid X-Signature header, or invalid body.',
    schema: {
      example: {
        statusCode: 400,
        message:
          'Missing X-Signature header. Please verify the webhook is correctly configured.',
        error: 'Bad Request',
      },
    },
  })
  @ApiUnauthorizedResponse({
    description: 'Invalid webhook signature.',
    schema: {
      example: {
        statusCode: 400,
        message: 'Invalid webhook signature. Unauthorised webhook source.',
        error: 'Bad Request',
      },
    },
  })
  @ApiNotFoundResponse({
    description: 'Payment not found.',
    schema: {
      example: {
        statusCode: 404,
        message:
          'Payment with ID 123e4567-e89b-12d3-a456-426614174000 not found',
        error: 'Not Found',
      },
    },
  })
  @ApiInternalServerErrorResponse({
    description: 'Internal server error.',
    schema: {
      example: { statusCode: 500, message: 'Internal server error' },
    },
  })
  handleWebhook(@Body() webhookDto: PaymentWebhookDto) {
    return this.paymentsService.handleWebhook(webhookDto);
  }
}

import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  UseGuards,
  UseInterceptors,
  BadRequestException,
  Headers,
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
  ApiResponse,
} from '@nestjs/swagger';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { PaymentsService } from './payments.service';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { BulkCreatePaymentsResponseDto } from './dto/bulk-create-payments-response.dto';
import { RefundPaymentDto } from './dto/refund-payment.dto';
import { PaymentWebhookDto } from './dto/payment-webhook.dto';
import { GetPaymentsDto } from './dto/get-payments.dto';
import { Payment } from './payment.entity';
import { Refund } from './refund.entity';
import { WebhookThrottle, BulkThrottle } from '../throttler/throttler.decorator';
import { WebhookGuard } from './webhook.guard';
import { IdempotencyInterceptor } from './idempotency.interceptor';

@ApiTags('payments')
@Controller('v1/payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) { }

  @Post()
  @UseInterceptors(IdempotencyInterceptor)
  @ApiOperation({
    summary: 'Create a payment',
    description:
      'Initiates a new payment record with PENDING status. Supports idempotency via the Idempotency-Key header to safely retry requests without creating duplicates.',
  })
  @ApiHeader({
    name: 'Idempotency-Key',
    description:
      'Optional unique key to ensure idempotent payment creation. Keys are valid for 24 hours. Reusing a key with a different request body returns 422.',
    required: false,
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
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
    description:
      'Idempotency key reused with different request body, or other unprocessable entity error.',
    schema: {
      example: {
        statusCode: 422,
        message: 'Idempotency key reused with different request body',
      },
    },
  })
  @ApiInternalServerErrorResponse({
    description: 'Internal server error.',
    schema: {
      example: { statusCode: 500, message: 'Internal server error' },
    },
  })
  create(
    @Body() createPaymentDto: CreatePaymentDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.paymentsService.create(createPaymentDto, idempotencyKey);
  }

  @BulkThrottle()
  @Post('bulk')
  @ApiOperation({
    summary: 'Create multiple payments in a single transaction',
    description:
      'Creates up to 100 payments atomically. If any payment object is invalid or fails, the entire batch is rolled back.',
  })
  @ApiBody({ type: CreatePaymentDto, isArray: true })
  @ApiCreatedResponse({
    description: 'Bulk payments created successfully.',
    type: BulkCreatePaymentsResponseDto,
  })
  @ApiBadRequestResponse({
    description:
      'Validation failed, request body is empty, or batch size exceeds 100 items.',
    schema: {
      example: {
        statusCode: 400,
        message:
          'Payment batch must contain between 1 and 100 payment objects.',
        error: 'Bad Request',
      },
    },
  })
  async createBulk(@Body() createPaymentDtos: CreatePaymentDto[]) {
    if (!Array.isArray(createPaymentDtos)) {
      throw new BadRequestException(
        'Request body must be an array of payment objects.',
      );
    }

    if (createPaymentDtos.length === 0 || createPaymentDtos.length > 100) {
      throw new BadRequestException(
        'Payment batch must contain between 1 and 100 payment objects.',
      );
    }

    const paymentInstances = plainToInstance(
      CreatePaymentDto,
      createPaymentDtos,
    );

    const validationResults = await Promise.all(
      paymentInstances.map((paymentDto) => validate(paymentDto)),
    );

    const errors = validationResults.flatMap((result) => result);

    if (errors.length > 0) {
      throw new BadRequestException(errors);
    }

    return this.paymentsService.createBulk(paymentInstances);
  }

  @Get()
  @ApiOperation({
    summary: 'List all payments',
    description:
      'Returns payments with optional filtering by status, currency, date range, and amount range. Supports free-text search against description and externalReference. Results ordered by creation date (newest first).',
  })
  @ApiOkResponse({
    description: 'List of payments.',
    type: [Payment],
  })
  @ApiBadRequestResponse({
    description: 'Invalid filter parameters provided.',
    schema: {
      example: {
        statusCode: 400,
        message: 'from date must not be greater than to date',
        error: 'Bad Request',
      },
    },
  })
  @ApiInternalServerErrorResponse({
    description: 'Internal server error.',
    schema: {
      example: { statusCode: 500, message: 'Internal server error' },
    },
  })
  findAll(@Query() getPaymentsDto: GetPaymentsDto) {
    // Validate date range
    if (getPaymentsDto.from && getPaymentsDto.to) {
      const fromTime = new Date(getPaymentsDto.from).getTime();
      const toTime = new Date(getPaymentsDto.to).getTime();
      if (fromTime > toTime) {
        throw new BadRequestException('from date must not be greater than to date');
      }
    }

    return this.paymentsService.findAll(getPaymentsDto);
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
  async findOne(@Param('id') id: string) {
    const payment = await this.paymentsService.findOne(id);
    const refunds = await this.paymentsService.getRefunds(id);
    return { ...payment, refunds };
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

  @Post(':id/refund')
  @ApiOperation({
    summary: 'Refund a payment',
    description:
      'Issues a full or partial refund for a completed payment. Creates a refund record and updates payment status.',
  })
  @ApiParam({
    name: 'id',
    description: 'Payment UUID to refund',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @ApiBody({ type: RefundPaymentDto })
  @ApiCreatedResponse({
    description: 'Refund processed successfully.',
    schema: {
      example: {
        payment: {
          id: '123e4567-e89b-12d3-a456-426614174000',
          amount: '100.00',
          currency: 'USD',
          status: 'REFUNDED',
          refundedAmount: '100.00',
          createdAt: '2026-01-26T10:00:00.000Z',
          updatedAt: '2026-01-26T11:00:00.000Z',
        },
        refund: {
          id: '456e7890-e89b-12d3-a456-426614174000',
          paymentId: '123e4567-e89b-12d3-a456-426614174000',
          amount: '100.00',
          reason: 'Customer requested refund',
          createdAt: '2026-01-26T11:00:00.000Z',
        },
      },
    },
  })
  @ApiBadRequestResponse({
    description: 'Validation failed.',
    schema: {
      example: {
        statusCode: 400,
        message: ['Refund amount must be a positive number'],
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
  @ApiResponse({
    status: 409,
    description:
      'Payment cannot be refunded (already refunded, pending, or failed).',
    schema: {
      example: {
        statusCode: 409,
        message: 'Payment is already fully refunded',
        error: 'Conflict',
      },
    },
  })
  @ApiInternalServerErrorResponse({
    description: 'Internal server error.',
    schema: {
      example: { statusCode: 500, message: 'Internal server error' },
    },
  })
  refund(@Param('id') id: string, @Body() refundDto: RefundPaymentDto) {
    return this.paymentsService.refund(id, refundDto);
  }
}

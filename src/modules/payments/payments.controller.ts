import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  Req,
  Headers,
  HttpCode,
  HttpStatus,
  UseGuards,
  UseInterceptors,
  BadRequestException,
  Sse,
  MessageEvent,
  Res,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { SseJwtGuard } from '../auth/guards/sse-jwt.guard';
import { PaymentSseService } from './payment-sse.service';
import { MerchantsService } from '../merchants/merchants.service';

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
  ApiResponse,
  ApiBearerAuth,
  ApiQuery,
} from '@nestjs/swagger';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { PaymentsService } from './payments.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ExportPaymentsDto } from './dto/export-payments.dto';
import type { Request, Response } from 'express';
import {
  createPaymentsPdfDocument,
  paymentToCsvRow,
  writePaymentsPdfTable,
} from './export/payments-exporter';

import { CreatePaymentDto } from './dto/create-payment.dto';
import { BulkCreatePaymentsResponseDto } from './dto/bulk-create-payments-response.dto';
import { RefundPaymentDto } from './dto/refund-payment.dto';
import { PaymentWebhookDto } from './dto/payment-webhook.dto';
import { GetPaymentsDto, PaymentSortBy } from './dto/get-payments.dto';
import { PaymentTimelineEvent } from './dto/payment-timeline.dto';
import { Payment } from './payment.entity';
import { Refund } from './refund.entity';
import { SortOrder } from '../../common/dto/pagination.dto';
import {
  WebhookThrottle,
  BulkThrottle,
} from '../throttler/throttler.decorator';
import { WebhookGuard } from './webhook.guard';
import { IdempotencyInterceptor } from './idempotency.interceptor';
import { UpsertMerchantFeeConfigDto } from './dto/upsert-merchant-fee-config.dto';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../../common/constants/roles';

@ApiTags('payments')
@Controller('v1/payments')
export class PaymentsController {
  constructor(
    private readonly paymentsService: PaymentsService,
    private readonly paymentSseService: PaymentSseService,
    private readonly merchantsService: MerchantsService,
  ) { }

  @Post()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('bearer')
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
  @ApiHeader({
    name: 'X-Test-Mode',
    description:
      'Set to "true" to flag this request as a test payment. When the merchant has bypassInTestMode enabled (default), geo-restriction checks are skipped.',
    required: false,
    example: 'true',
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
  @ApiUnauthorizedResponse({
    description: 'Missing or invalid bearer token.',
    schema: {
      example: {
        statusCode: 401,
        message: 'Unauthorized',
      },
    },
  })
  @ApiResponse({
    status: 409,
    description: 'Idempotency key reused with a different request body.',
    schema: {
      example: {
        statusCode: 409,
        message: 'Idempotency key reused with different request body',
        error: 'Conflict',
      },
    },
  })
  @ApiResponse({
    status: 403,
    description: 'Payment blocked by merchant geo-restrictions.',
    schema: {
      example: {
        statusCode: 403,
        message: 'Payments from KP are not permitted by this merchant',
        error: 'Forbidden',
        code: 'geo_restricted',
      },
    },
  })
  @ApiInternalServerErrorResponse({
    description: 'Internal server error.',
    schema: {
      example: { statusCode: 500, message: 'Internal server error' },
    },
  })
  async create(
    @Body() createPaymentDto: CreatePaymentDto,
    @Req() req: Request,
    @Headers('x-test-mode') testModeHeader?: string,
  ) {
    await this.merchantsService.enforceGeoRestriction(
      createPaymentDto.merchantId,
      req.ip,
      testModeHeader === 'true',
    );
    return this.paymentsService.create(createPaymentDto);
  }

  @BulkThrottle()
  @Post('bulk')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('bearer')
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
  @ApiUnauthorizedResponse({
    description: 'Missing or invalid bearer token.',
    schema: {
      example: {
        statusCode: 401,
        message: 'Unauthorized',
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

  @Get('export')
  @ApiBearerAuth('bearer')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Export payments as CSV or PDF',
    description:
      'Exports filtered payments as a downloadable CSV or PDF file. Supports the same date range and status filters as the list endpoint.',
  })
  @ApiQuery({
    name: 'format',
    enum: ['csv', 'pdf'],
    required: true,
    example: 'csv',
  })
  @ApiQuery({ name: 'from', required: false, example: '2026-01-01T00:00:00Z' })
  @ApiQuery({ name: 'to', required: false, example: '2026-12-31T23:59:59Z' })
  @ApiQuery({
    name: 'status',
    required: false,
    description: 'Filter by status',
  })
  @ApiOkResponse({ description: 'Downloadable CSV or PDF file.' })
  @ApiBadRequestResponse({ description: 'Invalid format or date range.' })
  async exportPayments(
    @Query() exportDto: ExportPaymentsDto,
    @Res() res: Response,
  ): Promise<void> {
    if (exportDto.from && exportDto.to) {
      if (
        new Date(exportDto.from).getTime() > new Date(exportDto.to).getTime()
      ) {
        throw new BadRequestException(
          'from date must not be greater than to date',
        );
      }
    }

    const payments = await this.paymentsService.findForExport(exportDto);

    if (exportDto.format === 'csv') {
      const csvHeader =
        'id,amount,currency,status,externalReference,description,refundedAmount,cancelledAt,createdAt,updatedAt';
      const rows = payments.map(paymentToCsvRow);
      const csv = [csvHeader, ...rows].join('\n');

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader(
        'Content-Disposition',
        'attachment; filename="payments.csv"',
      );
      res.send(csv);
      return;
    }

    const doc = createPaymentsPdfDocument();
    writePaymentsPdfTable(doc, payments);
    doc.end();

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="payments.pdf"');
    doc.pipe(res);
  }

  @Post('merchant-fee-config/:merchantId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'Configure merchant fees (admin)' })
  async upsertMerchantFeeConfig(@Body() dto: UpsertMerchantFeeConfigDto) {
    return this.paymentsService.upsertMerchantFeeConfig(
      dto.merchantId ?? '',
      dto,
    );
  }

  @Get('merchant-fee-config/:merchantId/report')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'Get merchant fee report (admin)' })
  async getFeeReport(@Param('merchantId') merchantId: string) {
    return this.paymentsService.getFeeReport(merchantId);
  }

  @Get()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('bearer')
  @ApiOperation({
    summary: 'List all payments',
    description:
      'Returns payments with optional filtering by status, currency, date range, and amount range. Supports free-text search against description and externalReference. ' +
      'Supports cursor-based pagination (cursor param) and offset-based pagination (page param, default). ' +
      'When cursor is provided, the response includes nextCursor and hasMore fields for efficient navigation through large datasets. ' +
      'Sortable by created_at (default), amount, or status.',
  })
  @ApiQuery({
    name: 'cursor',
    required: false,
    description:
      'Cursor for cursor-based pagination (base64-encoded from previous response nextCursor). When provided, page is ignored.',
  })
  @ApiQuery({
    name: 'sortBy',
    required: false,
    enum: PaymentSortBy,
    description: 'Sort by field (default: created_at)',
  })
  @ApiQuery({
    name: 'order',
    required: false,
    enum: SortOrder,
    description: 'Sort order (default: DESC)',
  })
  @ApiOkResponse({
    description:
      'Paginated list of payments. Returns CursorPaginatedResult when cursor param is used, otherwise PaginatedResult.',
    schema: {
      oneOf: [
        {
          example: {
            data: [
              {
                id: '123e4567-e89b-12d3-a456-426614174000',
                amount: 100.5,
                currency: 'USD',
                status: 'COMPLETED',
                description: 'Payment for order #12345',
                externalReference: 'ext_ref_123',
                refundedAmount: 0,
                cancelledAt: null,
                metadata: null,
                createdAt: '2026-01-26T10:00:00.000Z',
                updatedAt: '2026-01-26T10:05:00.000Z',
              },
            ],
            nextCursor:
              'Y3JlYXRlZF9hdDoyMDI2LTAxLTI2VDEwOjAwOjAwLjAwMFo6MTIzZTQ1NjctZTg5Yi0xMmQzLWE0NTYtNDI2NjE0MTc0MDAw',
            hasMore: true,
          },
        },
        {
          example: {
            data: [],
            total: 0,
            page: 1,
            limit: 20,
          },
        },
      ],
    },
  })
  @ApiBadRequestResponse({
    description: 'Invalid filter parameters or cursor provided.',
    schema: {
      oneOf: [
        {
          example: {
            statusCode: 400,
            message: 'from date must not be greater than to date',
            error: 'Bad Request',
          },
        },
        {
          example: {
            statusCode: 400,
            message: 'Invalid cursor format',
            error: 'Bad Request',
          },
        },
      ],
    },
  })
  @ApiUnauthorizedResponse({
    description: 'Missing or invalid bearer token.',
    schema: {
      example: {
        statusCode: 401,
        message: 'Unauthorized',
      },
    },
  })
  @ApiInternalServerErrorResponse({
    description: 'Internal server error.',
    schema: {
      example: { statusCode: 500, message: 'Internal server error' },
    },
  })
  async findAll(@Query() getPaymentsDto: GetPaymentsDto) {
    if (getPaymentsDto.from && getPaymentsDto.to) {
      const fromTime = new Date(getPaymentsDto.from).getTime();
      const toTime = new Date(getPaymentsDto.to).getTime();
      if (fromTime > toTime) {
        throw new BadRequestException(
          'from date must not be greater than to date',
        );
      }
    }

    return this.paymentsService.findAll(getPaymentsDto);
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('bearer')
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
  @ApiUnauthorizedResponse({
    description: 'Missing or invalid bearer token.',
    schema: {
      example: {
        statusCode: 401,
        message: 'Unauthorized',
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
      'Updates payment status from an external provider. Requires X-Signature-Timestamp and a valid HMAC-SHA256 signature in X-Signature, computed over "<timestamp>.<raw_json_body>" using WEBHOOK_SECRET.',
  })
  @ApiHeader({
    name: 'X-Signature',
    description:
      'HMAC-SHA256 hex digest of "<X-Signature-Timestamp>.<raw request body>", keyed with WEBHOOK_SECRET',
    required: true,
    example: 'a1b2c3d4e5f6...',
  })
  @ApiHeader({
    name: 'X-Signature-Timestamp',
    description:
      'Unix timestamp (seconds). Requests older than configured tolerance are rejected.',
    required: true,
    example: '1753794900',
  })
  @ApiHeader({
    name: 'X-Signature-Nonce',
    description:
      'Optional unique nonce for replay protection when nonce cache is enabled.',
    required: false,
    example: '0f14f837-5d15-4333-a283-6fccc5e29f28',
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
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('bearer')
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
          initiatedBy: '789e0123-e89b-12d3-a456-426614174000',
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
  refund(
    @Param('id') id: string,
    @Body() refundDto: RefundPaymentDto,
    @Req() req: Request & { user?: { id: string } },
  ) {
    return this.paymentsService.refund(id, refundDto, req.user?.id);
  }

  @Post(':id/cancel')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('bearer')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Cancel a payment',
    description:
      'Cancels a PENDING payment. Only payments in PENDING status can be cancelled. Transitions payment to CANCELLED status.',
  })
  @ApiParam({
    name: 'id',
    description: 'Payment UUID to cancel',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @ApiOkResponse({
    description: 'Payment cancelled successfully.',
    schema: {
      example: {
        id: '123e4567-e89b-12d3-a456-426614174000',
        amount: '100.00',
        currency: 'USD',
        status: 'CANCELLED',
        description: 'Payment for order #12345',
        externalReference: null,
        refundedAmount: '0.00',
        cancelledAt: '2026-01-26T11:00:00.000Z',
        createdAt: '2026-01-26T10:00:00.000Z',
        updatedAt: '2026-01-26T11:00:00.000Z',
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
      'Payment cannot be cancelled (not in PENDING status or already in terminal state).',
    schema: {
      example: {
        statusCode: 409,
        message:
          'Cannot cancel payment with status COMPLETED. Only PENDING payments can be cancelled.',
        error: 'Conflict',
      },
    },
  })
  @ApiUnauthorizedResponse({
    description: 'Missing or invalid bearer token.',
    schema: {
      example: {
        statusCode: 401,
        message: 'Unauthorized',
      },
    },
  })
  @ApiInternalServerErrorResponse({
    description: 'Internal server error.',
    schema: {
      example: { statusCode: 500, message: 'Internal server error' },
    },
  })
  cancel(@Param('id') id: string) {
    return this.paymentsService.cancel(id);
  }

  @Get(':id/timeline')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('bearer')
  @ApiOperation({
    summary: 'Get payment timeline',
    description:
      'Returns a chronological timeline of events for a payment, including creation, status updates, cancellation, expiry, refunds, and dispute lifecycle events.',
  })
  @ApiParam({
    name: 'id',
    description: 'Payment UUID',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @ApiOkResponse({
    description: 'Payment timeline events.',
    schema: {
      example: [
        {
          type: 'payment.created',
          timestamp: '2026-01-26T10:00:00.000Z',
          data: { amount: 100.5, currency: 'USD', status: 'PENDING', description: 'Payment for order #12345' },
        },
        {
          type: 'payment.status_updated',
          timestamp: '2026-01-26T10:05:00.000Z',
          data: { status: 'COMPLETED' },
        },
      ],
    },
  })
  @ApiNotFoundResponse({ description: 'Payment not found.' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid bearer token.' })
  async getTimeline(@Param('id') id: string): Promise<PaymentTimelineEvent[]> {
    return this.paymentsService.getTimeline(id);
  }

  @Sse(':id/events')
  @UseGuards(SseJwtGuard)
  @ApiOperation({
    summary: 'Subscribe to real-time payment status events (SSE)',
    description:
      'Opens a Server-Sent Events stream for a payment. Emits a `payment.status_updated` event on every status transition. ' +
      'The connection closes automatically when the payment reaches a terminal state (COMPLETED, FAILED, CANCELLED, REFUNDED). ' +
      'Pass the JWT either as `Authorization: Bearer <token>` header or as `?token=<jwt>` query parameter (required for browser EventSource).',
  })
  @ApiParam({ name: 'id', description: 'Payment UUID' })
  @ApiQuery({
    name: 'token',
    required: false,
    description:
      'JWT bearer token (alternative to Authorization header for browser EventSource clients)',
  })
  @ApiBearerAuth('bearer')
  @ApiOkResponse({
    description: 'SSE stream of payment status events.',
    schema: {
      example: {
        type: 'payment.status_updated',
        data: {
          id: '123e4567-e89b-12d3-a456-426614174000',
          status: 'COMPLETED',
          updatedAt: '2026-01-26T11:00:00.000Z',
        },
      },
    },
  })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid JWT.' })
  @ApiNotFoundResponse({ description: 'Payment not found.' })
  streamEvents(@Param('id') id: string): Observable<MessageEvent> {
    return this.paymentSseService.subscribe(id);
  }
}

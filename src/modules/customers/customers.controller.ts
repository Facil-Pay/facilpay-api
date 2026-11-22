import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CustomersService } from './customers.service';
import { Customer } from './customer.entity';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { GetCustomersDto } from './dto/get-customers.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';
import {
  MergeCustomerDto,
  MergeCustomerResult,
} from './dto/merge-customer.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '../users/user.entity';
import { PaginatedResult } from '../../common/interfaces/paginated-result.interface';
import { CustomerPortalService } from './customer-portal.service';

@ApiTags('customers')
@ApiBearerAuth('bearer')
@UseGuards(JwtAuthGuard)
@Controller('v1/customers')
export class CustomersController {
  constructor(
    private readonly customersService: CustomersService,
    private readonly customerPortalService: CustomerPortalService,
  ) {}

  @Post()
  @ApiOperation({
    summary: 'Create a customer',
    description:
      'Creates a customer owned by the authenticated merchant. Email is unique per merchant, case-insensitively.',
  })
  @ApiBody({ type: CreateCustomerDto })
  @ApiCreatedResponse({ description: 'Customer created.', type: Customer })
  @ApiBadRequestResponse({ description: 'Invalid customer data.' })
  @ApiConflictResponse({
    description: 'The merchant already has a customer with this email.',
  })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid JWT.' })
  create(
    @Body() dto: CreateCustomerDto,
    @CurrentUser() user: User,
  ): Promise<Customer> {
    return this.customersService.create(user.id, dto);
  }

  @Get()
  @ApiOperation({
    summary: 'List customers',
    description:
      'Returns a paginated list of active customers owned by the authenticated merchant. Search is a case-insensitive partial match against email or name. Use `tag` to return only customers carrying that tag.',
  })
  @ApiOkResponse({
    description: 'Paginated customer list.',
    schema: {
      example: {
        data: [
          {
            id: '550e8400-e29b-41d4-a716-446655440000',
            merchantId: '3d813cbb-47fb-4ba1-8eae-6e8cd7f4b126',
            email: 'jane.doe@example.com',
            name: 'Jane Doe',
            phone: '+1-555-0100',
            metadata: { tier: 'gold' },
            tags: ['vip', 'wholesale'],
            createdAt: '2026-09-25T10:00:00.000Z',
            updatedAt: '2026-09-25T10:00:00.000Z',
            deletedAt: null,
          },
        ],
        total: 1,
        page: 1,
        limit: 20,
      },
    },
  })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid JWT.' })
  findAll(
    @Query() dto: GetCustomersDto,
    @CurrentUser() user: User,
  ): Promise<PaginatedResult<Customer>> {
    return this.customersService.findAll(user.id, dto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a customer by ID' })
  @ApiParam({ name: 'id', description: 'Customer UUID' })
  @ApiOkResponse({ description: 'Customer found.', type: Customer })
  @ApiNotFoundResponse({
    description:
      'Customer not found or not owned by the authenticated merchant.',
  })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid JWT.' })
  findOne(
    @Param('id') id: string,
    @CurrentUser() user: User,
  ): Promise<Customer> {
    return this.customersService.findOne(id, user.id);
  }

  @Post(':id/portal-sessions')
  @ApiOperation({
    summary: 'Create a customer portal session',
    description:
      'Creates a signed, customer-scoped portal URL that expires after one hour by default.',
  })
  @ApiParam({ name: 'id', description: 'Customer UUID' })
  @ApiCreatedResponse({
    description: 'Short-lived portal URL created.',
    schema: {
      example: {
        url: 'https://api.example.com/v1/public/customer-portal?token=<signed-token>',
        expiresAt: '2026-10-21T13:00:00.000Z',
      },
    },
  })
  @ApiNotFoundResponse({
    description:
      'Customer not found or not owned by the authenticated merchant.',
  })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid JWT.' })
  createPortalSession(
    @Param('id') id: string,
    @CurrentUser() user: User,
  ): Promise<{ url: string; expiresAt: string }> {
    return this.customerPortalService.createSession(id, user.id);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Update a customer',
    description:
      'Updates mutable customer fields for a customer owned by the authenticated merchant.',
  })
  @ApiParam({ name: 'id', description: 'Customer UUID' })
  @ApiBody({ type: UpdateCustomerDto })
  @ApiOkResponse({ description: 'Customer updated.', type: Customer })
  @ApiNotFoundResponse({
    description:
      'Customer not found or not owned by the authenticated merchant.',
  })
  @ApiConflictResponse({
    description: 'The merchant already has a customer with this email.',
  })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid JWT.' })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateCustomerDto,
    @CurrentUser() user: User,
  ): Promise<Customer> {
    return this.customersService.update(id, user.id, dto);
  }

  @Post(':id/merge')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Merge a duplicate customer into this customer',
    description:
      'Reassigns payments, invoices, recurring plans and checkout sessions from the duplicate to the customer in the path, then soft-deletes the duplicate and records mergedIntoId on it. Runs in a single transaction and is audit logged. Both customers must belong to the authenticated merchant.',
  })
  @ApiParam({ name: 'id', description: 'UUID of the surviving customer' })
  @ApiBody({ type: MergeCustomerDto })
  @ApiOkResponse({ description: 'Customers merged.' })
  @ApiBadRequestResponse({
    description: 'Invalid body, or a customer was merged into itself.',
  })
  @ApiNotFoundResponse({
    description:
      'Either customer not found or not owned by the authenticated merchant.',
  })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid JWT.' })
  merge(
    @Param('id') id: string,
    @Body() dto: MergeCustomerDto,
    @CurrentUser() user: User,
    @Req() req: Request,
  ): Promise<MergeCustomerResult> {
    return this.customersService.merge(id, dto.duplicateCustomerId, user.id, {
      id: user.id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete a customer',
    description:
      'Soft-deletes a customer owned by the authenticated merchant. Deleted customers are excluded from reads and payment ownership validation.',
  })
  @ApiParam({ name: 'id', description: 'Customer UUID' })
  @ApiNoContentResponse({ description: 'Customer deleted.' })
  @ApiNotFoundResponse({
    description:
      'Customer not found or not owned by the authenticated merchant.',
  })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid JWT.' })
  async remove(
    @Param('id') id: string,
    @CurrentUser() user: User,
  ): Promise<void> {
    await this.customersService.remove(id, user.id);
  }
}

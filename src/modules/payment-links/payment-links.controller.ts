import {
  Controller,
  Post,
  Get,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  UseGuards,
  Request,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiUnauthorizedResponse,
  ApiParam,
  ApiResponse,
  ApiQuery,
} from '@nestjs/swagger';
import { PaymentLinksService } from './payment-links.service';
import { CreatePaymentLinkDto } from './dto/create-payment-link.dto';
import { UpdatePaymentLinkDto } from './dto/update-payment-link.dto';
import { PaymentLink } from './payment-link.entity';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Public } from '../auth/decorators/public.decorator';
import { PaginationDto } from '../../common/dto/pagination.dto';

@ApiTags('payment-links')
@Controller('v1/payment-links')
@UseGuards(JwtAuthGuard)
export class PaymentLinksController {
  constructor(private readonly service: PaymentLinksService) {}

  @Post()
  @ApiBearerAuth('bearer')
  @ApiOperation({
    summary: 'Create a payment link',
    description: 'Generates a shareable payment link with a unique token.',
  })
  @ApiCreatedResponse({ description: 'Payment link created.', type: PaymentLink })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid JWT.' })
  create(@Body() dto: CreatePaymentLinkDto, @Request() req: any) {
    return this.service.create(dto, req.user.id);
  }

  @Get()
  @ApiBearerAuth('bearer')
  @ApiOperation({
    summary: 'List payment links for the authenticated merchant',
    description: 'Returns a paginated list of payment links belonging to the merchant.',
  })
  @ApiOkResponse({ description: 'Paginated list of payment links.' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid JWT.' })
  @ApiQuery({ name: 'page', required: false, example: 1, description: 'Page number' })
  @ApiQuery({ name: 'limit', required: false, example: 20, description: 'Items per page (max 100)' })
  @ApiQuery({ name: 'sortBy', required: false, example: 'createdAt', description: 'Sort field (createdAt, amount, views, completions, updatedAt)' })
  @ApiQuery({ name: 'order', required: false, enum: ['ASC', 'DESC'], description: 'Sort order' })
  findAll(@Query() pagination: PaginationDto, @Request() req: any) {
    return this.service.findAllByMerchant(req.user.id, pagination);
  }

  @Public()
  @Get(':token')
  @ApiOperation({
    summary: 'Retrieve a payment link by token',
    description: 'Public endpoint — no authentication required. Increments view count on each call.',
  })
  @ApiParam({ name: 'token', description: '16-byte hex token from the payment link URL' })
  @ApiOkResponse({ description: 'Payment link details.' })
  @ApiNotFoundResponse({ description: 'Link not found.' })
  @ApiResponse({ status: 410, description: 'Link expired or deactivated.' })
  findByToken(@Param('token') token: string) {
    return this.service.findByToken(token);
  }

  @Patch(':id')
  @ApiBearerAuth('bearer')
  @ApiOperation({
    summary: 'Update a payment link',
    description: 'Updates editable fields (amount, currency, description, expiresAt) of an existing payment link.',
  })
  @ApiParam({ name: 'id', description: 'Payment link UUID' })
  @ApiOkResponse({ description: 'Payment link updated.', type: PaymentLink })
  @ApiNotFoundResponse({ description: 'Link not found.' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid JWT.' })
  update(
    @Param('id') id: string,
    @Body() dto: UpdatePaymentLinkDto,
    @Request() req: any,
  ) {
    return this.service.update(id, req.user.id, dto);
  }

  @Delete(':id')
  @ApiBearerAuth('bearer')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Deactivate a payment link',
    description: 'Sets isActive to false. The link will return 410 Gone after deactivation.',
  })
  @ApiParam({ name: 'id', description: 'Payment link UUID' })
  @ApiNoContentResponse({ description: 'Link deactivated.' })
  @ApiNotFoundResponse({ description: 'Link not found.' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid JWT.' })
  deactivate(@Param('id') id: string, @Request() req: any) {
    return this.service.deactivate(id, req.user.id);
  }
}

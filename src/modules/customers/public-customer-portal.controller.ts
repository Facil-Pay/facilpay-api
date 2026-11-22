import { Controller, Get, Query, UnauthorizedException } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { Public } from '../auth/decorators/public.decorator';
import { CustomerPortalService } from './customer-portal.service';

@ApiTags('customer-portal')
@Controller('v1/public/customer-portal')
@Public()
export class PublicCustomerPortalController {
  constructor(private readonly customerPortalService: CustomerPortalService) {}

  @Get()
  @ApiOperation({
    summary: 'View customer invoices, payments, and recurring plans',
  })
  @ApiQuery({ name: 'token', required: true, description: 'Signed portal session token' })
  @ApiUnauthorizedResponse({ description: 'Portal link is invalid or expired.' })
  getPortal(@Query('token') token?: string) {
    if (!token) {
      throw new UnauthorizedException('Invalid or expired customer portal link');
    }
    return this.customerPortalService.getPortalData(token);
  }
}
import { Body, Controller, Get, Header, HttpCode, Param, ParseUUIDPipe, Post, Put, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOkResponse, ApiOperation, ApiParam, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { SamlService } from './saml.service';
import { ConfigureSamlDto, SamlCallbackDto } from './dto/saml.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { CurrentUser } from './decorators/current-user.decorator';
import { User } from '../users/user.entity';
@ApiTags('saml')
@Controller('v1/auth/saml')
export class SamlController {
  constructor(private readonly saml: SamlService) {}
  @Put('configuration') @UseGuards(JwtAuthGuard) @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'Configure SAML for the authenticated merchant owner' }) @ApiBody({ type: ConfigureSamlDto })
  @ApiOkResponse({ description: 'Public SAML configuration with issuer and callbackUrl' })
  configure(@CurrentUser() user: User, @Body() dto: ConfigureSamlDto) { return this.saml.configure(user.id, dto); }
  @Get('configuration') @UseGuards(JwtAuthGuard) @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'Get merchant SAML configuration' })
  async configuration(@CurrentUser() user: User) { return this.saml.publicConfig(await this.saml.load(user.id)); }
  @Get(':merchantId/metadata') @Header('Content-Type', 'application/samlmetadata+xml')
  @ApiOperation({ summary: 'Get SAML service provider metadata' }) @ApiParam({ name: 'merchantId', format: 'uuid' })
  metadata(@Param('merchantId', ParseUUIDPipe) id: string) { return this.saml.metadata(id); }
  @Get(':merchantId/login') @ApiOperation({ summary: 'Start SP-initiated SAML sign-in' })
  @ApiParam({ name: 'merchantId', format: 'uuid' })
  async login(@Param('merchantId', ParseUUIDPipe) id: string, @Res() response: Response) { response.redirect(await this.saml.start(id)); }
  @Post(':merchantId/acs') @HttpCode(200) @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Validate SP- or IdP-initiated SAML sign-in and create a normal session' })
  @ApiConsumes('application/x-www-form-urlencoded') @ApiBody({ type: SamlCallbackDto }) @ApiUnauthorizedResponse()
  @ApiOkResponse({ description: 'access_token, refresh_token and user; handle credentials securely' })
  callback(@Param('merchantId', ParseUUIDPipe) id: string, @Body() body: SamlCallbackDto, @Req() req: Request) {
    return this.saml.callback(id, body, req.ip, req.get('user-agent'));
  }
}

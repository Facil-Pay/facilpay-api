import { Body, Controller, Delete, Get, Header, HttpCode, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse, ApiOperation, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { CurrentUser } from '../decorators/current-user.decorator';
import { OAuthService } from './oauth.service';
import { ApproveOAuthDto, OAuthAuthorizationDto, OAuthTokenDto, RegisterOAuthAppDto } from './oauth.dto';

@ApiTags('oauth')
@ApiUnauthorizedResponse({ description: 'Invalid merchant session, client credentials, code or refresh token' })
@Controller('v1/oauth')
export class OAuthController {
  constructor(private readonly oauth: OAuthService) {}

  @Post('apps')
  @UseGuards(JwtAuthGuard) @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'Register a developer app; client secret is returned once' })
  @ApiCreatedResponse({ description: 'Registered client ID, one-time secret and app metadata' })
  register(@CurrentUser() user: { id: string }, @Body() dto: RegisterOAuthAppDto) { return this.oauth.register(user.id, dto); }

  @Get('consent')
  @UseGuards(JwtAuthGuard) @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'Get validated app and scope data for a consent screen' })
  @ApiOkResponse({ description: 'Client name, exact redirect URI and requested scopes' })
  consent(@Query() dto: OAuthAuthorizationDto) { return this.oauth.consent(dto); }

  @Post('authorize') @HttpCode(200)
  @UseGuards(JwtAuthGuard) @ApiBearerAuth('bearer')
  @Header('Cache-Control', 'no-store') @Header('Pragma', 'no-cache')
  @ApiOperation({ summary: 'Approve or deny app access; returns a validated redirect URL' })
  @ApiOkResponse({ description: 'Redirect URL with single-use authorization code or access_denied, and state' })
  authorize(@CurrentUser() user: { id: string }, @Body() dto: ApproveOAuthDto) { return this.oauth.authorize(user.id, dto); }

  @Post('token') @HttpCode(200)
  @Header('Cache-Control', 'no-store') @Header('Pragma', 'no-cache')
  @ApiOperation({ summary: 'Exchange a PKCE authorization code or rotate a refresh token', description: 'Accepts JSON or application/x-www-form-urlencoded. Client ID and secret are required in the body.' })
  @ApiOkResponse({ description: 'Scoped access token (1 hour) and rotating refresh token (30 days)' })
  token(@Body() dto: OAuthTokenDto) { return this.oauth.exchange(dto); }

  @Get('connections')
  @UseGuards(JwtAuthGuard) @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'List connected apps for the current merchant' })
  @ApiOkResponse({ description: 'Active grants with app names, scopes and connection IDs' })
  connections(@CurrentUser() user: { id: string }) { return this.oauth.connections(user.id); }

  @Delete('connections/:id') @HttpCode(204)
  @UseGuards(JwtAuthGuard) @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'Revoke a connected app and immediately invalidate its tokens' })
  @ApiNoContentResponse({ description: 'Grant revoked; its codes, access and refresh tokens are invalid' })
  revoke(@CurrentUser() user: { id: string }, @Param('id', ParseUUIDPipe) id: string) { return this.oauth.revoke(user.id, id); }
}

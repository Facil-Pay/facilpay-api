import {
  Controller,
  Post,
  Get,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiOkResponse,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiForbiddenResponse,
  ApiBadRequestResponse,
  ApiUnauthorizedResponse,
  ApiParam,
  ApiBody,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '../users/user.entity';
import { TeamService } from './team.service';
import { InviteMemberDto } from './dto/invite-member.dto';
import { UpdateMemberRoleDto } from './dto/update-member-role.dto';
import { MerchantMember } from './entities/merchant-member.entity';
import { MerchantInvitation } from './entities/merchant-invitation.entity';

@ApiTags('team')
@ApiBearerAuth('bearer')
@UseGuards(JwtAuthGuard)
@Controller('v1/team')
export class TeamController {
  constructor(private readonly teamService: TeamService) {}

  @Post('invitations')
  @ApiOperation({
    summary: 'Invite a user to the merchant account',
    description:
      'Sends a team invitation for the given email. The token returned must be shared with the invitee; the API never emails it directly.',
  })
  @ApiBody({ type: InviteMemberDto })
  @ApiCreatedResponse({
    description: 'Invitation created. Share `token` with the invitee.',
    schema: {
      example: {
        token: 'abc123...raw-token',
        invitation: {
          id: 'uuid',
          merchantId: 'uuid',
          email: 'teammate@example.com',
          role: 'DEVELOPER',
          expiresAt: '2026-10-02T10:00:00.000Z',
          createdAt: '2026-09-29T10:00:00.000Z',
        },
      },
    },
  })
  @ApiBadRequestResponse({ description: 'Validation error' })
  @ApiUnauthorizedResponse()
  async invite(
    @Body() dto: InviteMemberDto,
    @CurrentUser() user: User,
    @Req() req: Request,
  ) {
    return this.teamService.inviteMember(
      user.id,
      dto,
      user.id,
      req.ip,
      req.headers['user-agent'],
    );
  }

  @Get('invitations')
  @ApiOperation({
    summary: 'List pending team invitations',
    description: 'Returns pending (unaccepted, unrevoked, non-expired) invitations. Accessible only by the account owner or an ADMIN team member.',
  })
  @ApiOkResponse({ type: [MerchantInvitation] })
  @ApiForbiddenResponse({ description: 'Only the account owner or an admin can list invitations' })
  @ApiUnauthorizedResponse()
  listInvitations(
    @CurrentUser() user: User,
    @Req() req?: Request,
  ): Promise<MerchantInvitation[]> {
    const merchantId = (req?.headers?.['x-merchant-id'] as string) || user.id;
    return this.teamService.listPendingInvitations(merchantId, user.id);
  }

  @Post('invitations/:id/resend')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Resend a pending team invitation',
    description: 'Rotates the invitation token and extends its expiry. Accessible only by the account owner or an ADMIN team member.',
  })
  @ApiParam({ name: 'id', description: 'Invitation UUID' })
  @ApiOkResponse({
    description: 'Invitation token rotated and expiry extended.',
  })
  @ApiNotFoundResponse({ description: 'Invitation not found' })
  @ApiBadRequestResponse({ description: 'Invitation already accepted or revoked' })
  @ApiForbiddenResponse({ description: 'Only the account owner or an admin can resend invitations' })
  @ApiUnauthorizedResponse()
  resendInvitation(
    @Param('id') id: string,
    @CurrentUser() user: User,
    @Req() req?: Request,
  ) {
    const merchantId = (req?.headers?.['x-merchant-id'] as string) || user.id;
    return this.teamService.resendInvitation(
      merchantId,
      id,
      user.id,
      req?.ip,
      req?.headers?.['user-agent'],
    );
  }

  @Delete('invitations/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Revoke a pending team invitation',
    description: 'Marks a pending invitation as revoked so its token can no longer be accepted. Accessible only by the account owner or an ADMIN team member.',
  })
  @ApiParam({ name: 'id', description: 'Invitation UUID' })
  @ApiOkResponse({ type: MerchantInvitation })
  @ApiNotFoundResponse({ description: 'Invitation not found' })
  @ApiBadRequestResponse({ description: 'Invitation already accepted' })
  @ApiForbiddenResponse({ description: 'Only the account owner or an admin can revoke invitations' })
  @ApiUnauthorizedResponse()
  revokeInvitation(
    @Param('id') id: string,
    @CurrentUser() user: User,
    @Req() req?: Request,
  ): Promise<MerchantInvitation> {
    const merchantId = (req?.headers?.['x-merchant-id'] as string) || user.id;
    return this.teamService.revokeInvitation(
      merchantId,
      id,
      user.id,
      req?.ip,
      req?.headers?.['user-agent'],
    );
  }

  @Post('invitations/:token/accept')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Accept a team invitation',
    description:
      "The authenticated user accepts an invitation using the raw token from the invitation email. The user's email must match the invitation's target email.",
  })
  @ApiParam({ name: 'token', description: 'Raw invitation token' })
  @ApiOkResponse({ type: MerchantMember })
  @ApiNotFoundResponse({ description: 'Invitation not found or already used' })
  @ApiBadRequestResponse({ description: 'Invitation expired or already accepted' })
  @ApiForbiddenResponse({ description: 'Email mismatch' })
  @ApiUnauthorizedResponse()
  accept(
    @Param('token') token: string,
    @CurrentUser() user: User,
    @Req() req: Request,
  ): Promise<MerchantMember> {
    return this.teamService.acceptInvitation(
      token,
      user.id,
      user.email,
      req.ip,
      req.headers['user-agent'],
    );
  }

  @Get('members')
  @ApiOperation({ summary: 'List team members of the authenticated merchant' })
  @ApiOkResponse({ type: [MerchantMember] })
  @ApiUnauthorizedResponse()
  listMembers(@CurrentUser() user: User): Promise<MerchantMember[]> {
    return this.teamService.listMembers(user.id);
  }

  @Patch('members/:id')
  @ApiOperation({ summary: 'Update a team member role' })
  @ApiParam({ name: 'id', description: 'Team member UUID' })
  @ApiBody({ type: UpdateMemberRoleDto })
  @ApiOkResponse({ type: MerchantMember })
  @ApiNotFoundResponse({ description: 'Member not found' })
  @ApiForbiddenResponse({ description: 'Member belongs to a different merchant' })
  @ApiBadRequestResponse({ description: 'Cannot change the owner role' })
  @ApiUnauthorizedResponse()
  updateMember(
    @Param('id') id: string,
    @Body() dto: UpdateMemberRoleDto,
    @CurrentUser() user: User,
    @Req() req: Request,
  ): Promise<MerchantMember> {
    return this.teamService.updateMemberRole(
      user.id,
      id,
      dto,
      user.id,
      req.ip,
      req.headers['user-agent'],
    );
  }

  @Delete('members/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove a team member' })
  @ApiParam({ name: 'id', description: 'Team member UUID' })
  @ApiNoContentResponse({ description: 'Member removed' })
  @ApiNotFoundResponse({ description: 'Member not found' })
  @ApiForbiddenResponse({ description: 'Cannot remove the merchant owner' })
  @ApiUnauthorizedResponse()
  removeMember(
    @Param('id') id: string,
    @CurrentUser() user: User,
    @Req() req: Request,
  ): Promise<void> {
    return this.teamService.removeMember(
      user.id,
      id,
      user.id,
      req.ip,
      req.headers['user-agent'],
    );
  }
}

import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomBytes, createHash } from 'crypto';
import { MerchantMember, TeamRole } from './entities/merchant-member.entity';
import { MerchantInvitation } from './entities/merchant-invitation.entity';
import { InviteMemberDto } from './dto/invite-member.dto';
import { UpdateMemberRoleDto } from './dto/update-member-role.dto';
import { AppLogger } from '../logger/logger.service';
import { Logger } from 'pino';
import { AuditLogsService, RecordAuditLogParams } from '../audit-logs/audit-logs.service';

@Injectable()
export class TeamService {
  private readonly logger: Logger;
  private static readonly INVITATION_TTL_HOURS = 72;

  constructor(
    @InjectRepository(MerchantMember)
    private readonly membersRepo: Repository<MerchantMember>,
    @InjectRepository(MerchantInvitation)
    private readonly invitationsRepo: Repository<MerchantInvitation>,
    private readonly auditLogsService: AuditLogsService,
    appLogger: AppLogger,
  ) {
    this.logger = appLogger.child({ module: TeamService.name });
  }

  async inviteMember(
    merchantId: string,
    dto: InviteMemberDto,
    actorId: string,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<{ token: string; invitation: MerchantInvitation }> {
    const existing = await this.membersRepo.findOne({
      where: { merchantId },
    });

    const existingMember = await this.invitationsRepo.findOne({
      where: { merchantId, email: dto.email.toLowerCase(), acceptedAt: null as any },
    });

    if (existingMember) {
      const now = new Date();
      if (!existingMember.revokedAt && existingMember.expiresAt > now) {
        throw new ConflictException(
          'An active invitation already exists for this email',
        );
      }
      await this.invitationsRepo.remove(existingMember);
    }

    const rawToken = randomBytes(32).toString('hex');
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    const expiresAt = new Date(
      Date.now() +
        TeamService.INVITATION_TTL_HOURS * 60 * 60 * 1000,
    );

    const invitation = await this.invitationsRepo.save(
      this.invitationsRepo.create({
        merchantId,
        email: dto.email.toLowerCase(),
        role: dto.role,
        tokenHash,
        invitedBy: actorId,
        expiresAt,
      }),
    );

    await this.auditLogsService.record({
      actorId,
      actorType: 'user',
      action: 'team.invitation.created',
      resourceType: 'merchant_invitation',
      resourceId: invitation.id,
      ipAddress,
      userAgent,
      metadata: { email: dto.email, role: dto.role, merchantId },
    });

    this.logger.info(
      { invitationId: invitation.id, merchantId, email: dto.email },
      'Team invitation created',
    );

    return { token: rawToken, invitation };
  }

  async acceptInvitation(
    rawToken: string,
    userId: string,
    userEmail: string,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<MerchantMember> {
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    const invitation = await this.invitationsRepo.findOne({
      where: { tokenHash },
    });

    if (!invitation) {
      throw new NotFoundException('Invitation not found or already used');
    }

    if (invitation.acceptedAt) {
      throw new BadRequestException('Invitation has already been accepted');
    }

    if (invitation.revokedAt) {
      throw new BadRequestException('Invitation has been revoked');
    }

    if (invitation.expiresAt < new Date()) {
      throw new BadRequestException('Invitation has expired');
    }

    if (invitation.email !== userEmail.toLowerCase()) {
      throw new ForbiddenException(
        'This invitation was sent to a different email address',
      );
    }

    const alreadyMember = await this.membersRepo.findOne({
      where: { merchantId: invitation.merchantId, userId },
    });
    if (alreadyMember) {
      throw new ConflictException('You are already a member of this merchant account');
    }

    const now = new Date();
    invitation.acceptedAt = now;
    await this.invitationsRepo.save(invitation);

    const member = await this.membersRepo.save(
      this.membersRepo.create({
        merchantId: invitation.merchantId,
        userId,
        role: invitation.role,
        invitedBy: invitation.invitedBy,
        joinedAt: now,
      }),
    );

    await this.auditLogsService.record({
      actorId: userId,
      actorType: 'user',
      action: 'team.invitation.accepted',
      resourceType: 'merchant_member',
      resourceId: member.id,
      ipAddress,
      userAgent,
      metadata: {
        merchantId: invitation.merchantId,
        role: invitation.role,
        invitationId: invitation.id,
      },
    });

    this.logger.info(
      { memberId: member.id, merchantId: member.merchantId, userId },
      'Team invitation accepted',
    );

    return member;
  }

  async listPendingInvitations(
    merchantId: string,
    actorId: string = merchantId,
  ): Promise<MerchantInvitation[]> {
    await this.assertOwnerOrAdmin(merchantId, actorId);
    const invitations = await this.invitationsRepo.find({
      where: { merchantId },
      order: { createdAt: 'DESC' },
    });
    const now = new Date();
    return invitations.filter(
      (inv) => !inv.acceptedAt && !inv.revokedAt && inv.expiresAt > now,
    );
  }

  async resendInvitation(
    merchantId: string,
    invitationId: string,
    actorId: string = merchantId,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<{ token: string; invitation: MerchantInvitation }> {
    await this.assertOwnerOrAdmin(merchantId, actorId);
    const invitation = await this.findOwnedInvitation(invitationId, merchantId);

    if (invitation.acceptedAt) {
      throw new BadRequestException('Invitation has already been accepted');
    }
    if (invitation.revokedAt) {
      throw new BadRequestException('Cannot resend a revoked invitation');
    }

    const rawToken = randomBytes(32).toString('hex');
    invitation.tokenHash = createHash('sha256').update(rawToken).digest('hex');
    invitation.expiresAt = new Date(
      Date.now() + TeamService.INVITATION_TTL_HOURS * 60 * 60 * 1000,
    );

    const saved = await this.invitationsRepo.save(invitation);

    await this.auditLogsService.record({
      actorId,
      actorType: 'user',
      action: 'team.invitation.resent',
      resourceType: 'merchant_invitation',
      resourceId: invitation.id,
      ipAddress,
      userAgent,
      metadata: { email: invitation.email, role: invitation.role, merchantId },
    });

    this.logger.info(
      { invitationId: invitation.id, merchantId, email: invitation.email },
      'Team invitation resent',
    );

    return { token: rawToken, invitation: saved };
  }

  async revokeInvitation(
    merchantId: string,
    invitationId: string,
    actorId: string = merchantId,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<MerchantInvitation> {
    await this.assertOwnerOrAdmin(merchantId, actorId);
    const invitation = await this.findOwnedInvitation(invitationId, merchantId);

    if (invitation.acceptedAt) {
      throw new BadRequestException('Cannot revoke an already accepted invitation');
    }

    invitation.revokedAt = new Date();
    const saved = await this.invitationsRepo.save(invitation);

    await this.auditLogsService.record({
      actorId,
      actorType: 'user',
      action: 'team.invitation.revoked',
      resourceType: 'merchant_invitation',
      resourceId: invitation.id,
      ipAddress,
      userAgent,
      metadata: { email: invitation.email, role: invitation.role, merchantId },
    });

    this.logger.info(
      { invitationId: invitation.id, merchantId, email: invitation.email },
      'Team invitation revoked',
    );

    return saved;
  }

  async listMembers(merchantId: string): Promise<MerchantMember[]> {
    return this.membersRepo.find({
      where: { merchantId },
      order: { joinedAt: 'ASC' },
    });
  }

  async updateMemberRole(
    merchantId: string,
    memberId: string,
    dto: UpdateMemberRoleDto,
    actorId: string,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<MerchantMember> {
    const member = await this.findOwnedMember(memberId, merchantId);

    if (member.userId === merchantId) {
      throw new BadRequestException('Cannot change the role of the merchant owner');
    }

    const previous = member.role;
    member.role = dto.role;
    const updated = await this.membersRepo.save(member);

    await this.auditLogsService.record({
      actorId,
      actorType: 'user',
      action: 'team.member.role_updated',
      resourceType: 'merchant_member',
      resourceId: member.id,
      ipAddress,
      userAgent,
      metadata: { from: previous, to: dto.role, merchantId },
    });

    return updated;
  }

  async removeMember(
    merchantId: string,
    memberId: string,
    actorId: string,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<void> {
    const member = await this.findOwnedMember(memberId, merchantId);

    if (member.userId === merchantId) {
      throw new BadRequestException('Cannot remove the merchant owner');
    }

    await this.membersRepo.remove(member);

    await this.auditLogsService.record({
      actorId,
      actorType: 'user',
      action: 'team.member.removed',
      resourceType: 'merchant_member',
      resourceId: memberId,
      ipAddress,
      userAgent,
      metadata: { merchantId, removedUserId: member.userId },
    });
  }

  async resolveEffectiveMerchantId(
    userId: string,
    requestedMerchantId?: string,
  ): Promise<string> {
    if (!requestedMerchantId || requestedMerchantId === userId) {
      return userId;
    }
    const membership = await this.membersRepo.findOne({
      where: { merchantId: requestedMerchantId, userId },
    });
    if (!membership) {
      throw new ForbiddenException(
        'You are not a member of the requested merchant account',
      );
    }
    return requestedMerchantId;
  }

  private async findOwnedMember(
    memberId: string,
    merchantId: string,
  ): Promise<MerchantMember> {
    const member = await this.membersRepo.findOne({ where: { id: memberId } });
    if (!member) throw new NotFoundException(`Team member ${memberId} not found`);
    if (member.merchantId !== merchantId) throw new ForbiddenException();
    return member;
  }

  private async findOwnedInvitation(
    invitationId: string,
    merchantId: string,
  ): Promise<MerchantInvitation> {
    const invitation = await this.invitationsRepo.findOne({
      where: { id: invitationId },
    });
    if (!invitation) {
      throw new NotFoundException(`Invitation ${invitationId} not found`);
    }
    if (invitation.merchantId !== merchantId) {
      throw new ForbiddenException();
    }
    return invitation;
  }

  private async assertOwnerOrAdmin(
    merchantId: string,
    actorId: string,
  ): Promise<void> {
    if (actorId === merchantId) {
      return;
    }
    const membership = await this.membersRepo.findOne({
      where: { merchantId, userId: actorId },
    });
    if (!membership || membership.role !== TeamRole.ADMIN) {
      throw new ForbiddenException(
        'Only the account owner or an admin can manage team invitations',
      );
    }
  }
}

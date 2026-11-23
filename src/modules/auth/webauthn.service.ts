import {
  Injectable,
  ForbiddenException,
  Optional,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { MerchantSecurityService } from '../merchants/merchant-security.service';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import type {
  AuthenticationResponseJSON,
  RegistrationResponseJSON,
  VerifiedAuthenticationResponse,
  VerifiedRegistrationResponse,
  WebAuthnCredential as SimpleWebAuthnCredential,
} from '@simplewebauthn/server';
import { IsNull, LessThan, MoreThan, Repository } from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { User } from '../users/user.entity';
import { WebAuthnChallenge } from './entities/webauthn-challenge.entity';
import { WebAuthnCredential } from './entities/webauthn-credential.entity';

const CHALLENGE_LIFETIME_MS = 5 * 60 * 1000;

@Injectable()
export class WebAuthnService {
  constructor(
    @InjectRepository(WebAuthnCredential)
    private readonly credentialRepository: Repository<WebAuthnCredential>,
    @InjectRepository(WebAuthnChallenge)
    private readonly challengeRepository: Repository<WebAuthnChallenge>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    @Optional() private readonly security?: MerchantSecurityService,
  ) {}

  async hasCredentials(userId: string): Promise<boolean> {
    return (await this.credentialRepository.countBy({ userId })) > 0;
  }

  async registrationOptions(userId: string) {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    const credentials = await this.credentialRepository.find({
      where: { userId },
    });
    const rpID = this.getRpId();
    const options = await generateRegistrationOptions({
      rpName: this.configService.get<string>('WEBAUTHN_RP_NAME', 'FacilPay'),
      rpID,
      userName: user.email,
      userDisplayName: user.name ?? user.email,
      userID: Buffer.from(user.id),
      attestationType: 'none',
      authenticatorSelection: {
        residentKey: 'preferred',
        userVerification: 'required',
      },
      excludeCredentials: credentials.map((credential) => ({
        id: credential.credentialId,
        transports: credential.transports,
      })),
    });

    return {
      options,
      challengeToken: await this.createChallengeToken(
        userId,
        'registration',
        options.challenge,
      ),
    };
  }

  async verifyRegistration(
    userId: string,
    challengeToken: string,
    response: RegistrationResponseJSON,
    name: string,
  ) {
    const challenge = await this.loadChallenge(
      challengeToken,
      userId,
      'registration',
    );
    let verification: VerifiedRegistrationResponse;
    try {
      verification = await verifyRegistrationResponse({
        response,
        expectedChallenge: challenge.challenge,
        expectedOrigin: this.getOrigin(),
        expectedRPID: this.getRpId(),
        requireUserVerification: true,
      });
    } catch {
      throw new UnauthorizedException('Invalid passkey registration response');
    }

    if (!verification.verified || !verification.registrationInfo) {
      throw new UnauthorizedException('Invalid passkey registration response');
    }

    await this.consumeChallenge(challenge);
    const credential = verification.registrationInfo.credential;
    const saved = await this.credentialRepository.save(
      this.credentialRepository.create({
        userId,
        credentialId: credential.id,
        publicKey: Buffer.from(credential.publicKey),
        counter: credential.counter,
        transports: credential.transports ?? response.response.transports ?? [],
        name: name.trim(),
        lastUsedAt: null,
      }),
    );

    return this.toPublicCredential(saved);
  }

  async authenticationOptions(twoFactorToken: string) {
    const { userId } = await this.getTwoFactorUserId(twoFactorToken);
    const credentials = await this.credentialRepository.find({
      where: { userId },
    });
    if (credentials.length === 0) {
      throw new UnauthorizedException(
        'No passkeys are registered for this user',
      );
    }

    const options = await generateAuthenticationOptions({
      rpID: this.getRpId(),
      userVerification: 'required',
      allowCredentials: credentials.map((credential) => ({
        id: credential.credentialId,
        transports: credential.transports,
      })),
    });

    return {
      options,
      challengeToken: await this.createChallengeToken(
        userId,
        'authentication',
        options.challenge,
      ),
    };
  }

  async verifyAuthentication(
    twoFactorToken: string,
    challengeToken: string,
    response: AuthenticationResponseJSON,
  ): Promise<{ userId: string; deviceId?: string }> {
    const { userId, deviceId } = await this.getTwoFactorUserId(twoFactorToken);
    const challenge = await this.loadChallenge(
      challengeToken,
      userId,
      'authentication',
    );
    const credential = await this.credentialRepository.findOne({
      where: { credentialId: response.id, userId },
    });
    if (!credential)
      throw new UnauthorizedException('Invalid passkey response');

    const authenticator: SimpleWebAuthnCredential = {
      id: credential.credentialId,
      publicKey: Uint8Array.from(credential.publicKey),
      counter: credential.counter,
      transports: credential.transports,
    };
    let verification: VerifiedAuthenticationResponse;
    try {
      verification = await verifyAuthenticationResponse({
        response,
        expectedChallenge: challenge.challenge,
        expectedOrigin: this.getOrigin(),
        expectedRPID: this.getRpId(),
        credential: authenticator,
        requireUserVerification: true,
      });
    } catch {
      throw new UnauthorizedException('Invalid passkey response');
    }
    if (!verification.verified) {
      throw new UnauthorizedException('Invalid passkey response');
    }
    if (
      credential.counter > 0 &&
      verification.authenticationInfo.newCounter <= credential.counter
    ) {
      throw new UnauthorizedException(
        'Passkey signature counter did not advance',
      );
    }

    await this.consumeChallenge(challenge);
    const result = await this.credentialRepository
      .createQueryBuilder()
      .update(WebAuthnCredential)
      .set({
        counter: verification.authenticationInfo.newCounter,
        lastUsedAt: new Date(),
      })
      .where('id = :id', { id: credential.id })
      .andWhere('counter = :counter', { counter: credential.counter })
      .execute();
    if (!result.affected) {
      throw new UnauthorizedException('Passkey signature counter changed');
    }

    return { userId, deviceId };
  }

  async listCredentials(userId: string) {
    const credentials = await this.credentialRepository.find({
      where: { userId },
      order: { createdAt: 'ASC' },
    });
    return credentials.map((credential) => this.toPublicCredential(credential));
  }

  async renameCredential(userId: string, credentialId: string, name: string) {
    const credential = await this.credentialRepository.findOne({
      where: { id: credentialId, userId },
    });
    if (!credential) throw new NotFoundException('Passkey not found');
    credential.name = name.trim();
    return this.toPublicCredential(
      await this.credentialRepository.save(credential),
    );
  }

  async deleteCredential(userId: string, credentialId: string): Promise<void> {
    if (this.security && await this.security.requiresSecondFactor(userId)) {
      const user = await this.userRepository.findOneBy({ id: userId });
      if (!user?.twoFactorEnabled && await this.credentialRepository.countBy({ userId }) <= 1) {
        throw new ForbiddenException('Your merchant team requires at least one second factor');
      }
    }
    const result = await this.credentialRepository.delete({
      id: credentialId,
      userId,
    });
    if (!result.affected) throw new NotFoundException('Passkey not found');
  }

  @Cron(CronExpression.EVERY_DAY_AT_2AM)
  async pruneExpiredChallenges(): Promise<void> {
    await this.challengeRepository.delete({ expiresAt: LessThan(new Date()) });
  }

  private async createChallengeToken(
    userId: string,
    purpose: 'registration' | 'authentication',
    challengeValue: string,
  ): Promise<string> {
    const challenge = await this.challengeRepository.save(
      this.challengeRepository.create({
        userId,
        purpose,
        challenge: challengeValue,
        expiresAt: new Date(Date.now() + CHALLENGE_LIFETIME_MS),
        consumedAt: null,
      }),
    );
    return this.jwtService.signAsync(
      {
        sub: userId,
        challengeId: challenge.id,
        purpose: `webauthn-${purpose}`,
      },
      { expiresIn: '5m' },
    );
  }

  private async loadChallenge(
    token: string,
    userId: string,
    purpose: 'registration' | 'authentication',
  ): Promise<WebAuthnChallenge> {
    try {
      const claims = await this.jwtService.verifyAsync<{
        sub: string;
        challengeId: string;
        purpose: string;
      }>(token);
      if (claims.sub !== userId || claims.purpose !== `webauthn-${purpose}`) {
        throw new UnauthorizedException('Invalid passkey challenge');
      }
      const challenge = await this.challengeRepository.findOne({
        where: {
          id: claims.challengeId,
          userId,
          purpose,
          consumedAt: IsNull(),
          expiresAt: MoreThan(new Date()),
        },
      });
      if (!challenge)
        throw new UnauthorizedException('Passkey challenge expired');
      return challenge;
    } catch {
      throw new UnauthorizedException('Invalid or expired passkey challenge');
    }
  }

  private async consumeChallenge(challenge: WebAuthnChallenge): Promise<void> {
    const result = await this.challengeRepository
      .createQueryBuilder()
      .update(WebAuthnChallenge)
      .set({ consumedAt: new Date() })
      .where(
        'id = :id AND "userId" = :userId AND purpose = :purpose AND "consumedAt" IS NULL AND "expiresAt" > :now',
        {
          id: challenge.id,
          userId: challenge.userId,
          purpose: challenge.purpose,
          now: new Date(),
        },
      )
      .execute();
    if (!result.affected)
      throw new UnauthorizedException('Passkey challenge already used');
  }

  private async getTwoFactorUserId(
    token: string,
  ): Promise<{ userId: string; deviceId?: string }> {
    try {
      const claims = await this.jwtService.verifyAsync<{
        sub: string;
        purpose: string;
        deviceId?: string;
      }>(token);
      if (claims.purpose !== 'two-factor-login' || !claims.sub) {
        throw new UnauthorizedException('Invalid two-factor login token');
      }
      return { userId: claims.sub, deviceId: claims.deviceId };
    } catch {
      throw new UnauthorizedException(
        'Invalid or expired two-factor login token',
      );
    }
  }

  private getOrigin(): string {
    const configuredOrigin =
      this.configService.get<string>('WEBAUTHN_ORIGIN') ??
      this.configService.get<string>('APP_URL', 'http://localhost:3000');
    return new URL(configuredOrigin).origin;
  }

  private getRpId(): string {
    const configured = this.configService.get<string>('WEBAUTHN_RP_ID');
    return configured ?? new URL(this.getOrigin()).hostname;
  }

  private toPublicCredential(credential: WebAuthnCredential) {
    return {
      id: credential.id,
      credentialId: credential.credentialId,
      name: credential.name,
      transports: credential.transports,
      createdAt: credential.createdAt,
      lastUsedAt: credential.lastUsedAt,
    };
  }
}

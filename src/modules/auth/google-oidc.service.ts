import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { createHash, randomBytes } from 'crypto';
import { firstValueFrom } from 'rxjs';
import { AppLogger } from '../logger/logger.service';
import { Logger } from 'pino';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';

interface GoogleStateRecord {
  stateHash: string;
  codeChallenge: string;
  redirectUri: string;
  expiresAt: number;
}

function base64UrlEncode(buffer: Buffer): string {
  return buffer
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function sha256Base64Url(input: string): string {
  return base64UrlEncode(createHash('sha256').update(input).digest());
}

@Injectable()
export class GoogleOidcService {
  private readonly logger: Logger;
  private readonly states = new Map<string, GoogleStateRecord>();

  constructor(
    private readonly configService: ConfigService,
    private readonly httpService: HttpService,
    private readonly authService: AuthService,
    private readonly usersService: UsersService,
    appLogger: AppLogger,
  ) {
    this.logger = appLogger.child({ module: GoogleOidcService.name });
  }

  private getConfig() {
    const clientId = this.configService.get<string>('GOOGLE_CLIENT_ID', '');
    const clientSecret = this.configService.get<string>('GOOGLE_CLIENT_SECRET', '');
    const redirectUri = this.configService.get<string>('GOOGLE_REDIRECT_URI', '');
    const issuer =
      this.configService.get<string>('GOOGLE_OIDC_ISSUER', 'https://accounts.google.com') ||
      'https://accounts.google.com';

    if (!clientId || !clientSecret || !redirectUri) {
      throw new BadRequestException(
        'Google sign-in is not configured. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and GOOGLE_REDIRECT_URI.',
      );
    }

    return { clientId, clientSecret, redirectUri, issuer };
  }

  async buildAuthorizeUrl(redirectUriOverride?: string): Promise<{
    url: string;
    state: string;
    codeVerifier: string;
    codeChallenge: string;
    expiresAt: string;
  }> {
    const { clientId, redirectUri, issuer } = this.getConfig();
    const effectiveRedirectUri = redirectUriOverride || redirectUri;

    const codeVerifier = base64UrlEncode(randomBytes(32));
    const codeChallenge = sha256Base64Url(codeVerifier);
    const state = randomBytes(16).toString('hex');
    const stateHash = createHash('sha256').update(state).digest('hex');
    const expiresAt = Date.now() + 10 * 60 * 1000;

    this.states.set(stateHash, {
      stateHash,
      codeChallenge,
      redirectUri: effectiveRedirectUri,
      expiresAt,
    });
    this.pruneStates();

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: effectiveRedirectUri,
      response_type: 'code',
      scope: 'openid email profile',
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      state,
    });

    return {
      url: `${issuer}/o/oauth2/v2/auth?${params.toString()}`,
      state,
      codeVerifier,
      codeChallenge,
      expiresAt: new Date(expiresAt).toISOString(),
    };
  }

  async handleCallback(
    code: string,
    codeVerifier: string,
    state: string,
    redirectUriOverride?: string,
    confirmLink?: boolean,
    ipAddress?: string,
    userAgent?: string,
  ) {
    const { clientId, clientSecret, redirectUri, issuer } = this.getConfig();
    const effectiveRedirectUri = redirectUriOverride || redirectUri;

    const stateHash = createHash('sha256').update(state).digest('hex');
    const stored = this.states.get(stateHash);
    if (!stored || stored.expiresAt <= Date.now()) {
      if (stored) this.states.delete(stateHash);
      throw new BadRequestException('Invalid or expired Google sign-in state');
    }
    if (stored.redirectUri !== effectiveRedirectUri) {
      throw new BadRequestException('redirectUri does not match the authorize step');
    }
    this.states.delete(stateHash);

    let tokenResponse: { id_token?: string; access_token?: string };
    try {
      const res = await firstValueFrom(
        this.httpService.post(
          'https://oauth2.googleapis.com/token',
          new URLSearchParams({
            code,
            client_id: clientId,
            client_secret: clientSecret,
            redirect_uri: effectiveRedirectUri,
            grant_type: 'authorization_code',
            code_verifier: codeVerifier,
          }).toString(),
          { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
        ),
      );
      tokenResponse = res.data;
    } catch (error) {
      this.logger.error(
        { error: error instanceof Error ? error.message : String(error) },
        'Google token exchange failed',
      );
      throw new UnauthorizedException('Google authorization code exchange failed');
    }

    if (!tokenResponse.id_token) {
      throw new UnauthorizedException('Google did not return an ID token');
    }

    const claims = this.decodeIdToken(tokenResponse.id_token);
    const email = String(claims.email || '').trim().toLowerCase();
    const emailVerified = claims.email_verified === true || claims.email_verified === 'true';

    if (!email) {
      throw new UnauthorizedException('Google account did not return an email address');
    }
    if (!emailVerified) {
      throw new ForbiddenException('Google email address is not verified');
    }
    if (issuer && claims.iss && ![issuer, 'https://accounts.google.com', 'accounts.google.com'].includes(claims.iss)) {
      throw new UnauthorizedException('Unexpected Google ID token issuer');
    }

    const existing = await this.usersService.findByEmail(email).catch(() => null);

    if (existing) {
      if (!confirmLink) {
        throw new ForbiddenException(
          'An account with this email already exists. Re-submit with confirmLink=true to link Google sign-in after confirmation.',
        );
      }
      if (!existing.isEmailVerified) {
        throw new ForbiddenException(
          'Existing account email is not verified. Verify the account email before linking Google sign-in.',
        );
      }
      if (existing.deletedAt || !existing.isActive) {
        throw new ForbiddenException('Account is not available for Google sign-in');
      }
      this.logger.info({ userId: existing.id, email }, 'Google sign-in linked to existing account');
      return this.authService.completeOAuthLogin(existing.id, ipAddress, userAgent);
    }

    const created = await this.usersService.create({
      email,
      password: `Google-oidc-${randomBytes(16).toString('hex')}1A`,
    });
    const maybeVerifier = this.usersService as unknown as {
      markEmailVerified?: (id: string) => Promise<void>;
    };
    if (typeof maybeVerifier.markEmailVerified === 'function') {
      await maybeVerifier.markEmailVerified(created.id).catch(() => undefined);
    }
    this.logger.info({ userId: created.id, email }, 'User created via Google sign-in');

    const fullUser = await this.usersService.findByEmail(email).catch(() => null);
    const userId = (fullUser as { id: string } | null)?.id ?? (created as { id: string }).id;
    return this.authService.completeOAuthLogin(userId, ipAddress, userAgent);
  }

  private decodeIdToken(idToken: string): Record<string, unknown> {
    const parts = idToken.split('.');
    if (parts.length < 2) {
      throw new UnauthorizedException('Malformed Google ID token');
    }
    try {
      const payload = Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
      return JSON.parse(payload) as Record<string, unknown>;
    } catch {
      throw new UnauthorizedException('Unable to decode Google ID token');
    }
  }

  private pruneStates(): void {
    const now = Date.now();
    for (const [key, record] of this.states.entries()) {
      if (record.expiresAt <= now) {
        this.states.delete(key);
      }
    }
  }
}

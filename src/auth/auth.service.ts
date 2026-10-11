import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes } from 'node:crypto';
import type { Env } from '../config/env.js';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { toMeDto } from '../users/users.service.js';
import type { AccessTokenPayload } from './auth-user.js';
import type { AccessTokenDto, LoginResponseDto } from './dto/auth.dto.js';
import {
  GoogleTokenVerifier,
  type GoogleProfile,
} from './google-token-verifier.js';

export interface TokenPair extends AccessTokenDto {
  refreshToken: string;
}

// A refresh token revoked this recently is treated as a race between two tabs/requests,
// not as theft: the caller gets a 401 but the user's other sessions survive.
const ROTATION_GRACE_MS = 30_000;

@Injectable()
export class AuthService {
  private readonly accessTtlSeconds: number;
  private readonly refreshTtlMs: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly google: GoogleTokenVerifier,
    config: ConfigService<Env, true>,
  ) {
    this.accessTtlSeconds = config.get('JWT_ACCESS_TTL_SECONDS', {
      infer: true,
    });
    this.refreshTtlMs =
      config.get('REFRESH_TOKEN_TTL_DAYS', { infer: true }) *
      24 *
      60 *
      60 *
      1000;
  }

  async loginWithGoogle(
    idToken: string,
  ): Promise<LoginResponseDto & { refreshToken: string }> {
    const profile = await this.google.verify(idToken);
    if (!profile.emailVerified) {
      throw new UnauthorizedException({
        code: 'AUTH_EMAIL_NOT_VERIFIED',
        message: 'Google account email is not verified',
      });
    }

    const { userId, isNewUser } = await this.findOrCreateGoogleUser(profile);
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: { subscription: true },
    });
    const tokens = await this.issueTokens(user.id, user.role);
    return { ...tokens, user: toMeDto(user), isNewUser };
  }

  /** Rotates the refresh token: the presented one is revoked and a new pair is issued. */
  async refresh(presentedToken: string | undefined): Promise<TokenPair> {
    if (!presentedToken) throw invalidRefresh();

    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: hashToken(presentedToken) },
      include: { user: { select: { id: true, role: true } } },
    });
    if (!stored || stored.expiresAt <= new Date()) throw invalidRefresh();

    if (stored.revokedAt) {
      if (Date.now() - stored.revokedAt.getTime() > ROTATION_GRACE_MS) {
        // An old token came back: assume it was stolen and end every session of this user.
        await this.revokeAllForUser(stored.userId);
      }
      throw invalidRefresh();
    }

    // Conditional update so two concurrent refreshes can't both rotate the same token.
    const { count } = await this.prisma.refreshToken.updateMany({
      where: { id: stored.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (count === 0) throw invalidRefresh();

    return this.issueTokens(stored.user.id, stored.user.role);
  }

  async logout(presentedToken: string | undefined): Promise<void> {
    if (!presentedToken) return;
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash: hashToken(presentedToken), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private async findOrCreateGoogleUser(
    profile: GoogleProfile,
    retried = false,
  ): Promise<{ userId: string; isNewUser: boolean }> {
    const email = profile.email.toLowerCase();
    try {
      return await this.prisma.$transaction(async (tx) => {
        const identity = await tx.identity.findUnique({
          where: {
            provider_providerId: {
              provider: 'GOOGLE',
              providerId: profile.sub,
            },
          },
        });
        if (identity) return { userId: identity.userId, isNewUser: false };

        // Same verified email already registered (e.g. via another provider): link it.
        const existing = await tx.user.findUnique({ where: { email } });
        if (existing) {
          await tx.identity.create({
            data: {
              userId: existing.id,
              provider: 'GOOGLE',
              providerId: profile.sub,
            },
          });
          return { userId: existing.id, isNewUser: false };
        }

        const created = await tx.user.create({
          data: {
            email,
            displayName: profile.name,
            avatarUrl: profile.picture,
            identities: {
              create: { provider: 'GOOGLE', providerId: profile.sub },
            },
            subscription: { create: {} },
          },
        });
        return { userId: created.id, isNewUser: true };
      });
    } catch (error) {
      // Two first-time sign-ins raced and the other one created the rows: look again.
      if (!retried && isUniqueViolation(error)) {
        return this.findOrCreateGoogleUser(profile, true);
      }
      throw error;
    }
  }

  private async issueTokens(
    userId: string,
    role: AccessTokenPayload['role'],
  ): Promise<TokenPair> {
    const payload: AccessTokenPayload = { sub: userId, role };
    const accessToken = await this.jwt.signAsync(payload, {
      expiresIn: this.accessTtlSeconds,
    });

    const refreshToken = randomBytes(32).toString('base64url');
    await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash: hashToken(refreshToken),
        expiresAt: new Date(Date.now() + this.refreshTtlMs),
      },
    });

    return { accessToken, expiresIn: this.accessTtlSeconds, refreshToken };
  }

  private async revokeAllForUser(userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}

// Refresh tokens are 256-bit random values, so a plain SHA-256 is enough to store them safely.
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function invalidRefresh() {
  return new UnauthorizedException({
    code: 'AUTH_INVALID_REFRESH_TOKEN',
    message: 'Refresh token is missing, invalid, expired or already used',
  });
}

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
}

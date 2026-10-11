import { Injectable, UnauthorizedException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { MeDto } from './dto/me.dto.js';
import type { UpdateMeDto } from './dto/update-me.dto.js';

const withSubscription = {
  include: { subscription: true },
} satisfies Prisma.UserDefaultArgs;

type UserWithSubscription = Prisma.UserGetPayload<typeof withSubscription>;

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async getMe(userId: string): Promise<MeDto> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      ...withSubscription,
    });
    if (!user) throw this.userGone();
    return toMeDto(user);
  }

  async updateMe(userId: string, dto: UpdateMeDto): Promise<MeDto> {
    try {
      const user = await this.prisma.user.update({
        where: { id: userId },
        data: dto,
        ...withSubscription,
      });
      return toMeDto(user);
    } catch (error) {
      if (isRecordNotFound(error)) throw this.userGone();
      throw error;
    }
  }

  /** Cascades to identities, tokens, decks, progress… (onDelete: Cascade in the schema). */
  async deleteMe(userId: string): Promise<void> {
    await this.prisma.user.deleteMany({ where: { id: userId } });
  }

  // The access token outlived the account (deleted within the token's TTL).
  private userGone() {
    return new UnauthorizedException({
      code: 'AUTH_USER_NOT_FOUND',
      message: 'User no longer exists',
    });
  }
}

export function toMeDto(user: UserWithSubscription): MeDto {
  const subscription = user.subscription;
  const isPremium =
    subscription?.plan === 'PREMIUM' &&
    subscription.status === 'ACTIVE' &&
    (!subscription.currentPeriodEnd ||
      subscription.currentPeriodEnd > new Date());

  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    nativeLang: user.nativeLang,
    targetLangs: user.targetLangs,
    role: user.role,
    timezone: user.timezone,
    dailyNewLimit: user.dailyNewLimit,
    plan: isPremium ? 'PREMIUM' : 'FREE',
    planExpiresAt: isPremium ? (subscription.currentPeriodEnd ?? null) : null,
    createdAt: user.createdAt,
  };
}

function isRecordNotFound(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2025'
  );
}

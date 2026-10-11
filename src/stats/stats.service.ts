import { BadRequestException, Injectable } from '@nestjs/common';
import type { AuthUser } from '../auth/auth-user.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  addDays,
  daysBetween,
  localDate,
  startOfDayInTimeZone,
} from '../study/day.js';
import type {
  ForecastDto,
  ForecastQueryDto,
  HeatmapDto,
  HeatmapQueryDto,
  OverviewDto,
} from './dto/stats.dto.js';
import { computeStreaks } from './streak.js';

/** A card counts as well known once its review interval reaches this many days (Anki's "mature"). */
export const MATURE_INTERVAL_DAYS = 21;
const MAX_HEATMAP_DAYS = 400;

// Timestamps are stored as UTC "timestamp without time zone"; these turn them into local dates.
// The time zone comes from the user's profile, already validated as an IANA zone.

@Injectable()
export class StatsService {
  constructor(private readonly prisma: PrismaService) {}

  async overview(user: AuthUser): Promise<OverviewDto> {
    const timezone = await this.timezone(user);
    const now = new Date();
    const today = localDate(now, timezone);
    const since30d = new Date(now.getTime() - 30 * 86_400_000);

    const [cards, totalReviews, reviewsToday, accuracy, studyDays] =
      await Promise.all([
        this.prisma.$queryRaw<
          { studied: bigint; learning: bigint; mature: bigint; due: bigint }[]
        >`
        SELECT
          COUNT(*) FILTER (WHERE state <> 'NEW') AS studied,
          COUNT(*) FILTER (WHERE state IN ('LEARNING', 'RELEARNING')) AS learning,
          COUNT(*) FILTER (WHERE state = 'REVIEW' AND "scheduledDays" >= ${MATURE_INTERVAL_DAYS}) AS mature,
          COUNT(*) FILTER (WHERE state <> 'NEW' AND due <= ${now}) AS due
        FROM "CardProgress" WHERE "userId" = ${user.id}::uuid`,
        this.prisma.reviewLog.count({ where: { userId: user.id } }),
        this.prisma.reviewLog.count({
          where: {
            userId: user.id,
            reviewedAt: { gte: startOfDayInTimeZone(now, timezone) },
          },
        }),
        this.prisma.reviewLog.groupBy({
          by: ['correct'],
          where: { userId: user.id, reviewedAt: { gte: since30d } },
          orderBy: { correct: 'asc' },
          _count: { _all: true },
        }),
        this.prisma.$queryRaw<{ day: string }[]>`
        SELECT DISTINCT to_char(("reviewedAt" AT TIME ZONE 'UTC') AT TIME ZONE ${timezone}, 'YYYY-MM-DD') AS day
        FROM "ReviewLog" WHERE "userId" = ${user.id}::uuid
        ORDER BY day`,
      ]);

    const correct = accuracy.find((row) => row.correct)?._count._all ?? 0;
    const answered = accuracy.reduce((sum, row) => sum + row._count._all, 0);
    const days = studyDays.map((row) => row.day);
    const streaks = computeStreaks(days, today);
    const [counts] = cards;

    return {
      studiedCards: Number(counts.studied),
      learningCards: Number(counts.learning),
      matureCards: Number(counts.mature),
      dueCards: Number(counts.due),
      totalReviews,
      reviewsToday,
      accuracy30d: answered
        ? Math.round((correct / answered) * 1000) / 1000
        : null,
      currentStreak: streaks.current,
      longestStreak: streaks.longest,
      studiedToday: days.at(-1) === today,
    };
  }

  async heatmap(user: AuthUser, query: HeatmapQueryDto): Promise<HeatmapDto> {
    const timezone = await this.timezone(user);
    const to = query.to ?? localDate(new Date(), timezone);
    const from = query.from ?? addDays(to, -364);
    const span = daysBetween(from, to);
    if (span < 0 || span >= MAX_HEATMAP_DAYS) {
      throw new BadRequestException({
        code: 'STATS_INVALID_RANGE',
        message: `from must be on or before to, and the range at most ${MAX_HEATMAP_DAYS} days`,
      });
    }

    // Coarse UTC bounds (±1 day covers every time zone) let the (userId, reviewedAt) index do the work.
    const lower = new Date(`${addDays(from, -1)}T00:00:00Z`);
    const upper = new Date(`${addDays(to, 2)}T00:00:00Z`);
    const rows = await this.prisma.$queryRaw<{ date: string; count: bigint }[]>`
      SELECT to_char(local_day, 'YYYY-MM-DD') AS date, COUNT(*) AS count
      FROM (
        SELECT (("reviewedAt" AT TIME ZONE 'UTC') AT TIME ZONE ${timezone})::date AS local_day
        FROM "ReviewLog"
        WHERE "userId" = ${user.id}::uuid AND "reviewedAt" >= ${lower} AND "reviewedAt" < ${upper}
      ) reviews
      WHERE local_day BETWEEN ${from}::date AND ${to}::date
      GROUP BY local_day
      ORDER BY local_day`;

    const days = rows.map((row) => ({
      date: row.date,
      count: Number(row.count),
    }));
    return {
      from,
      to,
      days,
      total: days.reduce((sum, day) => sum + day.count, 0),
    };
  }

  async forecast(
    user: AuthUser,
    query: ForecastQueryDto,
  ): Promise<ForecastDto> {
    const timezone = await this.timezone(user);
    const now = new Date();
    const today = localDate(now, timezone);
    const last = addDays(today, query.days - 1);
    const upper = new Date(`${addDays(last, 2)}T00:00:00Z`);

    const rows = await this.prisma.$queryRaw<{ date: string; count: bigint }[]>`
      SELECT to_char(GREATEST(local_day, ${today}::date), 'YYYY-MM-DD') AS date, COUNT(*) AS count
      FROM (
        SELECT ((cp.due AT TIME ZONE 'UTC') AT TIME ZONE ${timezone})::date AS local_day
        FROM "CardProgress" cp
        JOIN "Card" c ON c.id = cp."cardId"
        JOIN "Deck" d ON d.id = c."deckId"
        WHERE cp."userId" = ${user.id}::uuid
          AND cp.state <> 'NEW'
          AND cp.due < ${upper}
          AND (d."ownerId" = ${user.id}::uuid OR d.source = 'SYSTEM' OR d.visibility <> 'PRIVATE')
      ) due_cards
      WHERE local_day <= ${last}::date
      GROUP BY 1
      ORDER BY 1`;

    const counts = new Map(rows.map((row) => [row.date, Number(row.count)]));
    return {
      days: Array.from({ length: query.days }, (_, i) => {
        const date = addDays(today, i);
        return { date, count: counts.get(date) ?? 0 };
      }),
    };
  }

  private async timezone(user: AuthUser): Promise<string> {
    const profile = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: { timezone: true },
    });
    return profile?.timezone ?? 'Asia/Ho_Chi_Minh';
  }
}

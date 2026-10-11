import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { AuthUser } from '../auth/auth-user.js';
import { toCardDto } from '../cards/cards.service.js';
import { canRead, DecksService } from '../decks/decks.service.js';
import type {
  Card,
  CardProgress,
  Deck,
  Prisma,
} from '../generated/prisma/client.js';
import type { StudyMode } from '../generated/prisma/enums.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { gradeChoice, gradeTyped, normalizeAnswer } from './answer-check.js';
import { startOfDayInTimeZone } from './day.js';
import type {
  AnswerResultDto,
  CreateSessionDto,
  SessionQuestionDto,
  StudyQueueDto,
  StudyQueueQueryDto,
  StudySessionDto,
  StudySummaryDto,
  SubmitAnswerDto,
} from './dto/study.dto.js';
import { Scheduler } from './scheduler.js';

type CardWithDeck = Card & { deck: Deck };

interface QueueEntry {
  card: CardWithDeck;
  progress: CardProgress | null;
}

interface Queue {
  entries: QueueEntry[];
  dueCount: number;
  newRemainingToday: number;
}

const MULTIPLE_CHOICE_OPTIONS = 4;

/** Decks the caller may read (mirrors canRead in DecksService). */
function readableDeck(userId: string): Prisma.DeckWhereInput {
  return {
    OR: [
      { ownerId: userId },
      { source: 'SYSTEM' },
      { visibility: { not: 'PRIVATE' } },
    ],
  };
}

@Injectable()
export class StudyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly decks: DecksService,
    private readonly scheduler: Scheduler,
  ) {}

  async queue(
    user: AuthUser,
    query: StudyQueueQueryDto,
  ): Promise<StudyQueueDto> {
    const queue = await this.buildQueue(user, query.deckId, query.limit);
    return {
      items: queue.entries.map(({ card, progress }) => ({
        card: toCardDto(card),
        state: progress?.state ?? 'NEW',
        due: progress?.due ?? null,
        isNew: !progress,
      })),
      dueCount: queue.dueCount,
      newRemainingToday: queue.newRemainingToday,
    };
  }

  async createSession(
    user: AuthUser,
    dto: CreateSessionDto,
  ): Promise<StudySessionDto> {
    const { entries } = await this.buildQueue(user, dto.deckId, dto.limit);
    const now = new Date();
    const distractors =
      dto.mode === 'MULTIPLE_CHOICE'
        ? await this.distractorPools(entries)
        : new Map();

    const questions = entries.map(({ card, progress }): SessionQuestionDto => {
      const base = { cardId: card.id, deckId: card.deckId, isNew: !progress };
      const termPrompt = {
        text: card.term,
        phonetic: card.phonetic ?? undefined,
        audioUrl: card.audioUrl ?? undefined,
        lang: card.deck.frontLang,
      };
      switch (dto.mode) {
        case 'FLIP':
          return {
            ...base,
            prompt: termPrompt,
            card: toCardDto(card),
            previews: this.scheduler.preview(
              progress ?? this.scheduler.initial(now),
              now,
            ),
          };
        case 'MULTIPLE_CHOICE':
          return {
            ...base,
            prompt: termPrompt,
            choices: buildChoices(
              card.definition,
              distractors.get(card.deckId) ?? [],
            ),
          };
        case 'MATCH':
          return { ...base, prompt: termPrompt };
        case 'TYPE_ANSWER':
          return {
            ...base,
            prompt: {
              text: card.definition,
              imageUrl: card.imageUrl ?? undefined,
            },
            answerLength: [...card.term].length,
          };
        case 'DICTATION':
          return {
            ...base,
            prompt: {
              text: card.definition, // shown as a hint
              audioUrl: card.audioUrl ?? undefined,
              speakText: card.audioUrl ? undefined : card.term,
              lang: card.deck.frontLang,
            },
            answerLength: [...card.term].length,
          };
      }
    });

    return {
      mode: dto.mode,
      questions,
      matchChoices:
        dto.mode === 'MATCH'
          ? shuffle(entries.map(({ card }) => card.definition))
          : undefined,
    };
  }

  async submitAnswer(
    user: AuthUser,
    dto: SubmitAnswerDto,
  ): Promise<AnswerResultDto> {
    const card = await this.prisma.card.findUnique({
      where: { id: dto.cardId },
      include: { deck: true },
    });
    if (!card || !canRead(user, card.deck)) {
      throw new NotFoundException({
        code: 'CARD_NOT_FOUND',
        message: 'Card not found',
      });
    }

    const { expected, graded } = gradeAnswer(card, dto);
    const now = new Date();

    const next = await this.prisma.$transaction(async (tx) => {
      const key = { userId_cardId: { userId: user.id, cardId: card.id } };
      const current =
        (await tx.cardProgress.findUnique({ where: key })) ??
        this.scheduler.initial(now);
      const scheduled = this.scheduler.next(current, graded.rating, now);

      await tx.cardProgress.upsert({
        where: key,
        create: { userId: user.id, cardId: card.id, ...scheduled },
        update: scheduled,
      });
      await tx.reviewLog.create({
        data: {
          userId: user.id,
          cardId: card.id,
          mode: dto.mode,
          prevState: current.state,
          rating: graded.rating,
          correct: graded.correct,
          answer: dto.answer,
          durationMs: dto.durationMs,
          reviewedAt: now,
        },
      });
      return scheduled;
    });

    return {
      correct: graded.correct,
      rating: graded.rating,
      expected,
      distance: graded.distance,
      state: next.state,
      due: next.due,
      scheduledDays: next.scheduledDays,
    };
  }

  async summary(user: AuthUser): Promise<StudySummaryDto> {
    const rows = await this.prisma.$queryRaw<
      {
        deckId: string;
        title: string;
        cardCount: number;
        dueCount: bigint;
        studiedCount: bigint;
      }[]
    >`
      SELECT d.id AS "deckId", d.title, d."cardCount",
        COUNT(cp."cardId") FILTER (WHERE cp.state <> 'NEW' AND cp.due <= now()) AS "dueCount",
        COUNT(cp."cardId") AS "studiedCount"
      FROM "Deck" d
      LEFT JOIN "Card" c ON c."deckId" = d.id
      LEFT JOIN "CardProgress" cp ON cp."cardId" = c.id AND cp."userId" = ${user.id}::uuid
      WHERE (d."ownerId" = ${user.id}::uuid OR d.source = 'SYSTEM' OR d.visibility <> 'PRIVATE')
        AND (
          d."ownerId" = ${user.id}::uuid
          OR EXISTS (
            SELECT 1 FROM "CardProgress" p JOIN "Card" pc ON pc.id = p."cardId"
            WHERE pc."deckId" = d.id AND p."userId" = ${user.id}::uuid
          )
        )
      GROUP BY d.id
      ORDER BY "dueCount" DESC, d."updatedAt" DESC`;

    const decks = rows.map((row) => ({
      deckId: row.deckId,
      title: row.title,
      dueCount: Number(row.dueCount),
      newCount: Math.max(row.cardCount - Number(row.studiedCount), 0),
    }));
    return {
      decks,
      totalDue: decks.reduce((sum, deck) => sum + deck.dueCount, 0),
      newRemainingToday: await this.newRemainingToday(user),
    };
  }

  /**
   * Due reviews (oldest first), then new cards up to the daily new-card allowance.
   * With a deckId: that deck (must be readable). Without: due cards from any readable deck,
   * new cards from my own decks and decks I've started studying.
   */
  private async buildQueue(
    user: AuthUser,
    deckId: string | undefined,
    limit: number,
  ): Promise<Queue> {
    if (deckId) await this.decks.findReadable(user, deckId);
    const now = new Date();

    const dueWhere: Prisma.CardProgressWhereInput = {
      userId: user.id,
      state: { not: 'NEW' },
      due: { lte: now },
      card: deckId ? { deckId } : { deck: readableDeck(user.id) },
    };
    const [due, dueCount, newRemainingToday] = await Promise.all([
      this.prisma.cardProgress.findMany({
        where: dueWhere,
        include: { card: { include: { deck: true } } },
        orderBy: { due: 'asc' },
        take: limit,
      }),
      this.prisma.cardProgress.count({ where: dueWhere }),
      this.newRemainingToday(user),
    ]);

    const newTake = Math.min(newRemainingToday, limit - due.length);
    const fresh =
      newTake > 0
        ? await this.prisma.card.findMany({
            where: {
              progress: { none: { userId: user.id } },
              ...(deckId
                ? { deckId }
                : {
                    deck: {
                      AND: [
                        readableDeck(user.id),
                        {
                          OR: [
                            { ownerId: user.id },
                            {
                              cards: {
                                some: {
                                  progress: { some: { userId: user.id } },
                                },
                              },
                            },
                          ],
                        },
                      ],
                    },
                  }),
            },
            include: { deck: true },
            orderBy: [{ deck: { createdAt: 'asc' } }, { position: 'asc' }],
            take: newTake,
          })
        : [];

    return {
      entries: [
        ...due.map(({ card, ...progress }) => ({ card, progress })),
        ...fresh.map((card) => ({ card, progress: null })),
      ],
      dueCount,
      newRemainingToday,
    };
  }

  private async newRemainingToday(user: AuthUser): Promise<number> {
    const profile = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: { dailyNewLimit: true, timezone: true },
    });
    if (!profile) return 0;
    const introducedToday = await this.prisma.reviewLog.count({
      where: {
        userId: user.id,
        prevState: 'NEW',
        reviewedAt: { gte: startOfDayInTimeZone(new Date(), profile.timezone) },
      },
    });
    return Math.max(profile.dailyNewLimit - introducedToday, 0);
  }

  /** A random sample of definitions per deck, used as wrong options. */
  private async distractorPools(
    entries: QueueEntry[],
  ): Promise<Map<string, string[]>> {
    const deckIds = [...new Set(entries.map(({ card }) => card.deckId))];
    const pools = await Promise.all(
      deckIds.map(async (id) => {
        const rows = await this.prisma.$queryRaw<{ definition: string }[]>`
          SELECT definition FROM "Card" WHERE "deckId" = ${id}::uuid ORDER BY random() LIMIT 50`;
        return [id, rows.map((row) => row.definition)] as const;
      }),
    );
    return new Map(pools);
  }
}

function gradeAnswer(card: Card, dto: SubmitAnswerDto) {
  if (dto.mode === 'FLIP') {
    if (!dto.rating) {
      throw new BadRequestException({
        code: 'STUDY_RATING_REQUIRED',
        message: 'rating is required for FLIP',
      });
    }
    return {
      expected: card.definition,
      graded: { correct: dto.rating !== 'AGAIN', rating: dto.rating },
    };
  }

  if (dto.answer === undefined) {
    throw new BadRequestException({
      code: 'STUDY_ANSWER_REQUIRED',
      message: `answer is required for ${dto.mode}`,
    });
  }
  const typed: StudyMode[] = ['TYPE_ANSWER', 'DICTATION'];
  return typed.includes(dto.mode)
    ? { expected: card.term, graded: gradeTyped(dto.answer, card.term) }
    : {
        expected: card.definition,
        graded: gradeChoice(dto.answer, card.definition, dto.durationMs),
      };
}

/** The correct definition plus up to 3 different ones, shuffled. */
function buildChoices(correct: string, pool: string[]): string[] {
  const seen = new Set([normalizeAnswer(correct)]);
  const wrong: string[] = [];
  for (const option of shuffle(pool)) {
    const key = normalizeAnswer(option);
    if (seen.has(key)) continue;
    seen.add(key);
    wrong.push(option);
    if (wrong.length === MULTIPLE_CHOICE_OPTIONS - 1) break;
  }
  return shuffle([correct, ...wrong]);
}

function shuffle<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { AuthUser } from '../auth/auth-user.js';
import { paginationArgs } from '../common/pagination.js';
import type { Deck, Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type {
  CreateDeckDto,
  DeckDetailDto,
  DeckDto,
  DeckListDto,
  ListDecksQueryDto,
  UpdateDeckDto,
} from './dto/deck.dto.js';

export const MAX_CARDS_PER_DECK = 5000;

/** Anyone can read system decks and non-private decks; private decks only by their owner. */
export function canRead(user: AuthUser, deck: Deck): boolean {
  return (
    deck.ownerId === user.id ||
    deck.source === 'SYSTEM' ||
    deck.visibility !== 'PRIVATE'
  );
}

/** Owners edit their decks; admins also curate system decks. */
export function canEdit(user: AuthUser, deck: Deck): boolean {
  return (
    deck.ownerId === user.id ||
    (deck.source === 'SYSTEM' && user.role === 'ADMIN')
  );
}

@Injectable()
export class DecksService {
  constructor(private readonly prisma: PrismaService) {}

  async list(user: AuthUser, query: ListDecksQueryDto): Promise<DeckListDto> {
    const where: Prisma.DeckWhereInput = {
      ownerId: user.id,
      frontLang: query.frontLang,
      title: query.q ? { contains: query.q, mode: 'insensitive' } : undefined,
    };
    const [decks, total] = await this.prisma.$transaction([
      this.prisma.deck.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        ...paginationArgs(query),
      }),
      this.prisma.deck.count({ where }),
    ]);
    return {
      items: decks.map((deck) => toDeckDto(deck, user)),
      page: query.page,
      pageSize: query.pageSize,
      total,
    };
  }

  async create(user: AuthUser, dto: CreateDeckDto): Promise<DeckDto> {
    const deck = await this.prisma.deck.create({
      data: { ...dto, ownerId: user.id, source: 'USER' },
    });
    return toDeckDto(deck, user);
  }

  async get(user: AuthUser, id: string): Promise<DeckDetailDto> {
    const deck = await this.findReadable(user, id);
    return {
      ...toDeckDto(deck, user),
      progress: await this.progress(user, deck),
    };
  }

  async update(
    user: AuthUser,
    id: string,
    dto: UpdateDeckDto,
  ): Promise<DeckDto> {
    await this.findEditable(user, id);
    const deck = await this.prisma.deck.update({ where: { id }, data: dto });
    return toDeckDto(deck, user);
  }

  async remove(user: AuthUser, id: string): Promise<void> {
    await this.findEditable(user, id);
    await this.prisma.deck.delete({ where: { id } }); // cards and progress cascade
  }

  /** Copies a readable deck (system, public, unlisted or own) into a new private deck of the caller. */
  async clone(user: AuthUser, id: string): Promise<DeckDto> {
    const source = await this.findReadable(user, id);
    const cards = await this.prisma.card.findMany({
      where: { deckId: id },
      orderBy: { position: 'asc' },
    });

    const copy = await this.prisma.$transaction(async (tx) => {
      const deck = await tx.deck.create({
        data: {
          ownerId: user.id,
          title: source.title,
          description: source.description,
          frontLang: source.frontLang,
          backLang: source.backLang,
          coverUrl: source.coverUrl,
          source: 'USER',
          visibility: 'PRIVATE',
          cardCount: cards.length,
        },
      });
      await tx.card.createMany({
        data: cards.map((card, index) => ({
          deckId: deck.id,
          term: card.term,
          definition: card.definition,
          phonetic: card.phonetic,
          partOfSpeech: card.partOfSpeech,
          example: card.example,
          exampleTrans: card.exampleTrans,
          imageUrl: card.imageUrl,
          audioUrl: card.audioUrl,
          position: index,
        })),
      });
      return deck;
    });
    return toDeckDto(copy, user);
  }

  /** 404 unless the caller may read the deck; private decks of others look like they don't exist. */
  async findReadable(user: AuthUser, id: string): Promise<Deck> {
    const deck = await this.prisma.deck.findUnique({ where: { id } });
    if (!deck || !canRead(user, deck)) {
      throw new NotFoundException({
        code: 'DECK_NOT_FOUND',
        message: 'Deck not found',
      });
    }
    return deck;
  }

  /** Like findReadable, plus 403 when the caller can see the deck but not change it. */
  async findEditable(user: AuthUser, id: string): Promise<Deck> {
    const deck = await this.findReadable(user, id);
    if (!canEdit(user, deck)) {
      throw new ForbiddenException({
        code: 'DECK_FORBIDDEN',
        message: 'Only the owner can change this deck; clone it to edit a copy',
      });
    }
    return deck;
  }

  private async progress(user: AuthUser, deck: Deck) {
    const where: Prisma.CardProgressWhereInput = {
      userId: user.id,
      card: { deckId: deck.id },
    };
    const [byState, dueCount] = await this.prisma.$transaction([
      this.prisma.cardProgress.groupBy({
        by: ['state'],
        where,
        orderBy: { state: 'asc' },
        _count: { _all: true },
      }),
      this.prisma.cardProgress.count({
        where: { ...where, state: { not: 'NEW' }, due: { lte: new Date() } },
      }),
    ]);

    const count = (state: string) =>
      byState.find((row) => row.state === state)?._count._all ?? 0;
    const learningCount = count('LEARNING') + count('RELEARNING');
    const reviewCount = count('REVIEW');
    return {
      newCount: Math.max(deck.cardCount - learningCount - reviewCount, 0),
      learningCount,
      reviewCount,
      dueCount,
    };
  }
}

export function toDeckDto(deck: Deck, user: AuthUser): DeckDto {
  return {
    id: deck.id,
    title: deck.title,
    description: deck.description,
    frontLang: deck.frontLang,
    backLang: deck.backLang,
    source: deck.source,
    visibility: deck.visibility,
    coverUrl: deck.coverUrl,
    cardCount: deck.cardCount,
    isOwner: canEdit(user, deck),
    createdAt: deck.createdAt,
    updatedAt: deck.updatedAt,
  };
}

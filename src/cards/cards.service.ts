import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { AuthUser } from '../auth/auth-user.js';
import {
  paginationArgs,
  type PaginationQueryDto,
} from '../common/pagination.js';
import {
  canEdit,
  canRead,
  DecksService,
  MAX_CARDS_PER_DECK,
} from '../decks/decks.service.js';
import type { Card } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CardImportParseError, parseCardImport } from './card-import.js';
import type {
  CardDto,
  CardInputDto,
  CardListDto,
  ImportCardsDto,
  ImportResultDto,
  UpdateCardDto,
} from './dto/card.dto.js';

export const MAX_IMPORT_ROWS = 2000;

const OPTIONAL_FIELDS = [
  'phonetic',
  'partOfSpeech',
  'example',
  'exampleTrans',
  'imageUrl',
  'audioUrl',
] as const;

@Injectable()
export class CardsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly decks: DecksService,
  ) {}

  async list(
    user: AuthUser,
    deckId: string,
    query: PaginationQueryDto,
  ): Promise<CardListDto> {
    await this.decks.findReadable(user, deckId);
    const [cards, total] = await this.prisma.$transaction([
      this.prisma.card.findMany({
        where: { deckId },
        orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
        ...paginationArgs(query),
      }),
      this.prisma.card.count({ where: { deckId } }),
    ]);

    // Progress is per user: only the caller's rows, only for this page of cards.
    const progress = await this.prisma.cardProgress.findMany({
      where: { userId: user.id, cardId: { in: cards.map((card) => card.id) } },
      select: {
        cardId: true,
        state: true,
        due: true,
        lastReview: true,
        reps: true,
        lapses: true,
      },
    });
    const byCard = new Map(
      progress.map(({ cardId, ...rest }) => [cardId, rest]),
    );

    return {
      items: cards.map((card) => ({
        ...toCardDto(card),
        progress: byCard.get(card.id) ?? null,
      })),
      page: query.page,
      pageSize: query.pageSize,
      total,
    };
  }

  async add(
    user: AuthUser,
    deckId: string,
    inputs: CardInputDto[],
  ): Promise<CardDto[]> {
    await this.decks.findEditable(user, deckId);
    return this.append(deckId, inputs);
  }

  async import(
    user: AuthUser,
    deckId: string,
    dto: ImportCardsDto,
  ): Promise<ImportResultDto> {
    await this.decks.findEditable(user, deckId);

    let parsed;
    try {
      parsed = parseCardImport(dto.content, {
        delimiter: dto.delimiter,
        hasHeader: dto.hasHeader,
      });
    } catch (error) {
      if (!(error instanceof CardImportParseError)) throw error;
      throw new BadRequestException({
        code: 'IMPORT_PARSE_ERROR',
        message: `Could not read the file: ${error.message}`,
      });
    }

    if (parsed.cards.length > MAX_IMPORT_ROWS) {
      throw new HttpException(
        {
          code: 'IMPORT_TOO_LARGE',
          message: `At most ${MAX_IMPORT_ROWS} cards per import (got ${parsed.cards.length})`,
        },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    if (!dto.dryRun && parsed.cards.length > 0) {
      await this.append(
        deckId,
        parsed.cards.map(({ line: _line, ...card }) => card),
      );
    }
    return {
      delimiter: parsed.delimiter,
      importedCount: dto.dryRun ? 0 : parsed.cards.length,
      cards: parsed.cards,
      errors: parsed.errors,
    };
  }

  async update(
    user: AuthUser,
    cardId: string,
    dto: UpdateCardDto,
  ): Promise<CardDto> {
    await this.findEditable(user, cardId);
    const card = await this.prisma.card.update({
      where: { id: cardId },
      data: emptyToNull(dto),
    });
    return toCardDto(card);
  }

  async remove(user: AuthUser, cardId: string): Promise<void> {
    const card = await this.findEditable(user, cardId);
    await this.prisma.$transaction([
      this.prisma.card.delete({ where: { id: cardId } }),
      this.prisma.deck.update({
        where: { id: card.deckId },
        data: { cardCount: { decrement: 1 } },
      }),
    ]);
  }

  /** Appends cards at the end of the deck and keeps Deck.cardCount in sync. */
  private async append(
    deckId: string,
    inputs: CardInputDto[],
  ): Promise<CardDto[]> {
    return this.prisma.$transaction(async (tx) => {
      // Updating the deck row first locks it, so concurrent appends to the same deck
      // serialize here and can't both pass the limit check or reuse positions.
      const deck = await tx.deck.update({
        where: { id: deckId },
        data: { cardCount: { increment: inputs.length } },
      });
      if (deck.cardCount > MAX_CARDS_PER_DECK) {
        throw new HttpException(
          {
            code: 'DECK_CARD_LIMIT',
            message: `A deck can hold at most ${MAX_CARDS_PER_DECK} cards`,
          },
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }

      const { _max } = await tx.card.aggregate({
        where: { deckId },
        _max: { position: true },
      });
      const start = (_max.position ?? -1) + 1;
      const cards = await tx.card.createManyAndReturn({
        data: inputs.map((input, index) => ({
          ...emptyToNull(input),
          term: input.term,
          definition: input.definition,
          deckId,
          position: start + index,
        })),
      });
      return cards.sort((a, b) => a.position - b.position).map(toCardDto);
    });
  }

  private async findEditable(user: AuthUser, cardId: string): Promise<Card> {
    const card = await this.prisma.card.findUnique({
      where: { id: cardId },
      include: { deck: true },
    });
    if (!card || !canRead(user, card.deck)) {
      throw new NotFoundException({
        code: 'CARD_NOT_FOUND',
        message: 'Card not found',
      });
    }
    if (!canEdit(user, card.deck)) {
      throw new ForbiddenException({
        code: 'DECK_FORBIDDEN',
        message: 'Only the owner can change this deck; clone it to edit a copy',
      });
    }
    return card;
  }
}

/** An empty optional field means "clear it". */
function emptyToNull<T extends Partial<CardInputDto>>(input: T): T {
  const output = { ...input };
  for (const field of OPTIONAL_FIELDS) {
    if (output[field] === '') (output as Record<string, unknown>)[field] = null;
  }
  return output;
}

export function toCardDto(card: Card): CardDto {
  return {
    id: card.id,
    deckId: card.deckId,
    term: card.term,
    definition: card.definition,
    phonetic: card.phonetic,
    partOfSpeech: card.partOfSpeech,
    example: card.example,
    exampleTrans: card.exampleTrans,
    imageUrl: card.imageUrl,
    audioUrl: card.audioUrl,
    position: card.position,
    createdAt: card.createdAt,
    updatedAt: card.updatedAt,
  };
}

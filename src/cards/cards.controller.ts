import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { CurrentUser, type AuthUser } from '../auth/auth-user.js';
import { PaginationQueryDto } from '../common/pagination.js';
import { CardsService } from './cards.service.js';
import {
  CardDto,
  CardListDto,
  CreateCardsDto,
  ImportCardsDto,
  ImportResultDto,
  UpdateCardDto,
} from './dto/card.dto.js';

@ApiTags('cards')
@ApiBearerAuth()
@Controller()
export class CardsController {
  constructor(private readonly cards: CardsService) {}

  @Get('decks/:deckId/cards')
  @ApiOkResponse({ type: CardListDto })
  @ApiNotFoundResponse({ description: 'DECK_NOT_FOUND' })
  list(
    @CurrentUser() user: AuthUser,
    @Param('deckId', ParseUUIDPipe) deckId: string,
    @Query() query: PaginationQueryDto,
  ): Promise<CardListDto> {
    return this.cards.list(user, deckId, query);
  }

  @Post('decks/:deckId/cards')
  @ApiCreatedResponse({
    type: [CardDto],
    description: 'Appended at the end of the deck',
  })
  @ApiForbiddenResponse({ description: 'DECK_FORBIDDEN' })
  @ApiNotFoundResponse({ description: 'DECK_NOT_FOUND' })
  @ApiUnprocessableEntityResponse({ description: 'DECK_CARD_LIMIT' })
  add(
    @CurrentUser() user: AuthUser,
    @Param('deckId', ParseUUIDPipe) deckId: string,
    @Body() dto: CreateCardsDto,
  ): Promise<CardDto[]> {
    return this.cards.add(user, deckId, dto.cards);
  }

  @Post('decks/:deckId/cards/import')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: ImportResultDto })
  @ApiBadRequestResponse({ description: 'IMPORT_PARSE_ERROR' })
  @ApiForbiddenResponse({ description: 'DECK_FORBIDDEN' })
  @ApiNotFoundResponse({ description: 'DECK_NOT_FOUND' })
  @ApiUnprocessableEntityResponse({
    description: 'IMPORT_TOO_LARGE | DECK_CARD_LIMIT',
  })
  import(
    @CurrentUser() user: AuthUser,
    @Param('deckId', ParseUUIDPipe) deckId: string,
    @Body() dto: ImportCardsDto,
  ): Promise<ImportResultDto> {
    return this.cards.import(user, deckId, dto);
  }

  @Patch('cards/:id')
  @ApiOkResponse({ type: CardDto })
  @ApiForbiddenResponse({ description: 'DECK_FORBIDDEN' })
  @ApiNotFoundResponse({ description: 'CARD_NOT_FOUND' })
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCardDto,
  ): Promise<CardDto> {
    return this.cards.update(user, id, dto);
  }

  @Delete('cards/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse()
  @ApiForbiddenResponse({ description: 'DECK_FORBIDDEN' })
  @ApiNotFoundResponse({ description: 'CARD_NOT_FOUND' })
  remove(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.cards.remove(user, id);
  }
}

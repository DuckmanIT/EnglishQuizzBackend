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
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser, type AuthUser } from '../auth/auth-user.js';
import { DecksService } from './decks.service.js';
import {
  CreateDeckDto,
  DeckDetailDto,
  DeckDto,
  DeckListDto,
  ListDecksQueryDto,
  UpdateDeckDto,
} from './dto/deck.dto.js';

@ApiTags('decks')
@ApiBearerAuth()
@Controller('decks')
export class DecksController {
  constructor(private readonly decks: DecksService) {}

  @Get()
  @ApiOkResponse({ type: DeckListDto, description: "The caller's own decks" })
  list(
    @CurrentUser() user: AuthUser,
    @Query() query: ListDecksQueryDto,
  ): Promise<DeckListDto> {
    return this.decks.list(user, query);
  }

  @Post()
  @ApiCreatedResponse({ type: DeckDto })
  create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateDeckDto,
  ): Promise<DeckDto> {
    return this.decks.create(user, dto);
  }

  @Get(':id')
  @ApiOkResponse({ type: DeckDetailDto })
  @ApiNotFoundResponse({ description: 'DECK_NOT_FOUND' })
  get(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<DeckDetailDto> {
    return this.decks.get(user, id);
  }

  @Patch(':id')
  @ApiOkResponse({ type: DeckDto })
  @ApiForbiddenResponse({ description: 'DECK_FORBIDDEN' })
  @ApiNotFoundResponse({ description: 'DECK_NOT_FOUND' })
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateDeckDto,
  ): Promise<DeckDto> {
    return this.decks.update(user, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse()
  @ApiForbiddenResponse({ description: 'DECK_FORBIDDEN' })
  @ApiNotFoundResponse({ description: 'DECK_NOT_FOUND' })
  remove(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.decks.remove(user, id);
  }

  @Post(':id/clone')
  @ApiCreatedResponse({
    type: DeckDto,
    description: 'A new private copy owned by the caller',
  })
  @ApiNotFoundResponse({ description: 'DECK_NOT_FOUND' })
  clone(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<DeckDto> {
    return this.decks.clone(user, id);
  }
}

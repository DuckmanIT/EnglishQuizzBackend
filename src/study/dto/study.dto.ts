import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { CardDto } from '../../cards/dto/card.dto.js';
import { CardState, Rating, StudyMode } from '../../generated/prisma/enums.js';

export class StudyQueueQueryDto {
  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Limit to one deck; omitted = all my decks and decks I study',
  })
  @IsOptional()
  @IsUUID()
  deckId?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;
}

export class CreateSessionDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  deckId?: string;

  @ApiProperty({ enum: StudyMode, enumName: 'StudyMode' })
  @IsEnum(StudyMode)
  mode: StudyMode;

  @ApiPropertyOptional({ minimum: 1, maximum: 50, default: 20 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  limit: number = 20;
}

export class SubmitAnswerDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  cardId: string;

  @ApiProperty({ enum: StudyMode, enumName: 'StudyMode' })
  @IsEnum(StudyMode)
  mode: StudyMode;

  @ApiPropertyOptional({
    enum: Rating,
    enumName: 'Rating',
    description: 'Required for FLIP (self-graded); ignored otherwise',
  })
  @IsOptional()
  @IsEnum(Rating)
  rating?: Rating;

  @ApiPropertyOptional({
    maxLength: 1000,
    description:
      'Required for every mode except FLIP: the chosen option (MULTIPLE_CHOICE, MATCH) or the typed text (TYPE_ANSWER, DICTATION)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  answer?: string;

  @ApiPropertyOptional({
    minimum: 0,
    description: 'Time spent on the question',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(3_600_000)
  durationMs?: number;
}

export class QueueItemDto {
  @ApiProperty({ type: CardDto })
  card: CardDto;

  @ApiProperty({ enum: CardState, enumName: 'CardState' })
  state: CardState;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  due: Date | null;

  @ApiProperty({ description: 'Never studied before' })
  isNew: boolean;
}

export class StudyQueueDto {
  @ApiProperty({
    type: [QueueItemDto],
    description: 'Due reviews first (oldest due first), then new cards',
  })
  items: QueueItemDto[];

  @ApiProperty({
    description:
      'All cards due now in this scope (may exceed the returned items)',
  })
  dueCount: number;

  @ApiProperty({
    description:
      'New cards still allowed today (dailyNewLimit minus new cards studied today)',
  })
  newRemainingToday: number;
}

export class RatingPreviewDto {
  @ApiProperty({ type: String, format: 'date-time' })
  AGAIN: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  HARD: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  GOOD: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  EASY: Date;
}

export class PromptDto {
  @ApiProperty({ description: 'Text shown to the learner' })
  text: string;

  @ApiPropertyOptional()
  phonetic?: string;

  @ApiPropertyOptional()
  imageUrl?: string;

  @ApiPropertyOptional()
  audioUrl?: string;

  @ApiPropertyOptional({
    description:
      'DICTATION only: text to pronounce with text-to-speech when there is no audioUrl. Do not display it.',
  })
  speakText?: string;

  @ApiPropertyOptional({
    description: 'Language of speakText / audio',
    example: 'en',
  })
  lang?: string;
}

export class SessionQuestionDto {
  @ApiProperty({ format: 'uuid' })
  cardId: string;

  @ApiProperty({ format: 'uuid' })
  deckId: string;

  @ApiProperty()
  isNew: boolean;

  @ApiProperty({ type: PromptDto })
  prompt: PromptDto;

  @ApiPropertyOptional({
    type: CardDto,
    description: 'FLIP only: the full card, to show its back',
  })
  card?: CardDto;

  @ApiPropertyOptional({
    type: RatingPreviewDto,
    description: 'FLIP only: next due date for each rating button',
  })
  previews?: RatingPreviewDto;

  @ApiPropertyOptional({
    type: [String],
    description:
      'MULTIPLE_CHOICE only: shuffled options (definitions); send the chosen one as `answer`',
  })
  choices?: string[];

  @ApiPropertyOptional({
    description:
      'TYPE_ANSWER / DICTATION only: number of characters in the expected answer',
  })
  answerLength?: number;
}

export class StudySessionDto {
  @ApiProperty({ enum: StudyMode, enumName: 'StudyMode' })
  mode: StudyMode;

  @ApiProperty({ type: [SessionQuestionDto] })
  questions: SessionQuestionDto[];

  @ApiPropertyOptional({
    type: [String],
    description:
      'MATCH only: every definition of the session, shuffled, to pair with the prompts',
  })
  matchChoices?: string[];
}

export class AnswerResultDto {
  @ApiProperty()
  correct: boolean;

  @ApiProperty({
    enum: Rating,
    enumName: 'Rating',
    description: 'Rating used for scheduling',
  })
  rating: Rating;

  @ApiProperty({ description: 'The correct answer, to show after answering' })
  expected: string;

  @ApiPropertyOptional({
    description: 'Typed modes: edit distance to the expected answer',
  })
  distance?: number;

  @ApiProperty({ enum: CardState, enumName: 'CardState' })
  state: CardState;

  @ApiProperty({
    type: String,
    format: 'date-time',
    description: 'Next review',
  })
  due: Date;

  @ApiProperty({
    description: 'Days until the next review (0 while still learning)',
  })
  scheduledDays: number;
}

export class DeckSummaryDto {
  @ApiProperty({ format: 'uuid' })
  deckId: string;

  @ApiProperty()
  title: string;

  @ApiProperty()
  dueCount: number;

  @ApiProperty({ description: 'Cards in the deck never studied' })
  newCount: number;
}

export class StudySummaryDto {
  @ApiProperty({
    type: [DeckSummaryDto],
    description: 'My decks and decks I study, most due first',
  })
  decks: DeckSummaryDto[];

  @ApiProperty()
  totalDue: number;

  @ApiProperty()
  newRemainingToday: number;
}

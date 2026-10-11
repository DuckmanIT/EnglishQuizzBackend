import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import {
  FIELD_MAX_LENGTH as MAX,
  type ImportDelimiter,
} from '../card-import.js';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class CardInputDto {
  @ApiProperty({ maxLength: MAX.term, example: 'apple' })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(MAX.term)
  term: string;

  @ApiProperty({ maxLength: MAX.definition, example: 'quả táo' })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(MAX.definition)
  definition: string;

  @ApiPropertyOptional({ maxLength: MAX.phonetic, example: '/ˈæp.əl/' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(MAX.phonetic)
  phonetic?: string;

  @ApiPropertyOptional({ maxLength: MAX.partOfSpeech, example: 'noun' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(MAX.partOfSpeech)
  partOfSpeech?: string;

  @ApiPropertyOptional({ maxLength: MAX.example })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(MAX.example)
  example?: string;

  @ApiPropertyOptional({ maxLength: MAX.exampleTrans })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(MAX.exampleTrans)
  exampleTrans?: string;

  @ApiPropertyOptional({ format: 'uri' })
  @IsOptional()
  @IsUrl({ protocols: ['https'], require_protocol: true })
  imageUrl?: string;

  @ApiPropertyOptional({ format: 'uri' })
  @IsOptional()
  @IsUrl({ protocols: ['https'], require_protocol: true })
  audioUrl?: string;
}

export class CreateCardsDto {
  @ApiProperty({ type: [CardInputDto], minItems: 1, maxItems: 500 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => CardInputDto)
  cards: CardInputDto[];
}

export class UpdateCardDto extends PartialType(CardInputDto) {}

const DELIMITERS: ImportDelimiter[] = [
  'auto',
  'tab',
  'comma',
  'semicolon',
  'dash',
];

export class ImportCardsDto {
  @ApiProperty({
    description:
      'File content (CSV/TSV) or pasted text. Columns without a header: term, definition, ' +
      'phonetic, partOfSpeech, example, exampleTrans.',
    maxLength: 1_000_000,
  })
  @IsString()
  @MinLength(1)
  @MaxLength(1_000_000)
  content: string;

  @ApiPropertyOptional({ enum: DELIMITERS, default: 'auto' })
  @IsOptional()
  @IsIn(DELIMITERS)
  delimiter?: ImportDelimiter;

  @ApiPropertyOptional({
    default: false,
    description:
      'First row holds column names (term/word/từ, definition/meaning/nghĩa, …)',
  })
  @IsOptional()
  @IsBoolean()
  hasHeader?: boolean;

  @ApiPropertyOptional({
    default: false,
    description: 'Only parse and return the preview; nothing is saved',
  })
  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;
}

export class CardDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  deckId: string;

  @ApiProperty()
  term: string;

  @ApiProperty()
  definition: string;

  @ApiProperty({ type: String, nullable: true })
  phonetic: string | null;

  @ApiProperty({ type: String, nullable: true })
  partOfSpeech: string | null;

  @ApiProperty({ type: String, nullable: true })
  example: string | null;

  @ApiProperty({ type: String, nullable: true })
  exampleTrans: string | null;

  @ApiProperty({ type: String, nullable: true })
  imageUrl: string | null;

  @ApiProperty({ type: String, nullable: true })
  audioUrl: string | null;

  @ApiProperty()
  position: number;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt: Date;
}

export class CardListDto {
  @ApiProperty({ type: [CardDto] })
  items: CardDto[];

  @ApiProperty()
  page: number;

  @ApiProperty()
  pageSize: number;

  @ApiProperty()
  total: number;
}

export class ImportCardDraftDto {
  @ApiProperty({ description: 'Line in the input the card came from' })
  line: number;

  @ApiProperty()
  term: string;

  @ApiProperty()
  definition: string;

  @ApiPropertyOptional()
  phonetic?: string;

  @ApiPropertyOptional()
  partOfSpeech?: string;

  @ApiPropertyOptional()
  example?: string;

  @ApiPropertyOptional()
  exampleTrans?: string;
}

export class ImportRowErrorDto {
  @ApiProperty()
  line: number;

  @ApiProperty({ example: 'Missing definition' })
  reason: string;
}

export class ImportResultDto {
  @ApiProperty({ enum: ['tab', 'comma', 'semicolon', 'dash'] })
  delimiter: string;

  @ApiProperty({ description: 'Cards saved (0 for a dry run)' })
  importedCount: number;

  @ApiProperty({ type: [ImportCardDraftDto], description: 'Parsed cards' })
  cards: ImportCardDraftDto[];

  @ApiProperty({
    type: [ImportRowErrorDto],
    description: 'Rows that were skipped',
  })
  errors: ImportRowErrorDto[];
}

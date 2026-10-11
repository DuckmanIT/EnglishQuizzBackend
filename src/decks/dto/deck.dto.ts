import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/pagination.js';
import { LANG_CODE } from '../../common/validation.js';
import { DeckSource, Visibility } from '../../generated/prisma/enums.js';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class CreateDeckDto {
  @ApiProperty({
    minLength: 1,
    maxLength: 100,
    example: 'IELTS Reading – Unit 1',
  })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  title: string;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiProperty({ example: 'en', description: 'Language of the front (term)' })
  @Matches(LANG_CODE, { message: 'frontLang must be an ISO 639 code' })
  frontLang: string;

  @ApiProperty({
    example: 'vi',
    description: 'Language of the back (definition)',
  })
  @Matches(LANG_CODE, { message: 'backLang must be an ISO 639 code' })
  backLang: string;

  @ApiPropertyOptional({
    enum: Visibility,
    enumName: 'Visibility',
    default: Visibility.PRIVATE,
  })
  @IsOptional()
  @IsEnum(Visibility)
  visibility?: Visibility;

  @ApiPropertyOptional({ format: 'uri' })
  @IsOptional()
  @IsUrl({ protocols: ['https'], require_protocol: true })
  coverUrl?: string;
}

export class UpdateDeckDto extends PartialType(CreateDeckDto) {}

export class ListDecksQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Search in the title' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  q?: string;

  @ApiPropertyOptional({ example: 'en' })
  @IsOptional()
  @Matches(LANG_CODE, { message: 'frontLang must be an ISO 639 code' })
  frontLang?: string;
}

export class DeckDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  title: string;

  @ApiProperty({ type: String, nullable: true })
  description: string | null;

  @ApiProperty({ example: 'en' })
  frontLang: string;

  @ApiProperty({ example: 'vi' })
  backLang: string;

  @ApiProperty({ enum: DeckSource, enumName: 'DeckSource' })
  source: DeckSource;

  @ApiProperty({ enum: Visibility, enumName: 'Visibility' })
  visibility: Visibility;

  @ApiProperty({ type: String, nullable: true })
  coverUrl: string | null;

  @ApiProperty()
  cardCount: number;

  @ApiProperty({
    description: 'True when the caller owns this deck and can edit it',
  })
  isOwner: boolean;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt: Date;
}

export class DeckProgressDto {
  @ApiProperty({ description: 'Cards never studied' })
  newCount: number;

  @ApiProperty({ description: 'Cards in (re)learning' })
  learningCount: number;

  @ApiProperty({ description: 'Cards in long-term review' })
  reviewCount: number;

  @ApiProperty({ description: 'Studied cards due now' })
  dueCount: number;
}

export class DeckDetailDto extends DeckDto {
  @ApiProperty({ type: DeckProgressDto, description: "The caller's progress" })
  progress: DeckProgressDto;
}

export class DeckListDto {
  @ApiProperty({ type: [DeckDto] })
  items: DeckDto[];

  @ApiProperty()
  page: number;

  @ApiProperty()
  pageSize: number;

  @ApiProperty()
  total: number;
}

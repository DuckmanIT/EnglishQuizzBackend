import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Matches, Max, Min } from 'class-validator';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export class OverviewDto {
  @ApiProperty({ description: 'Cards studied at least once' })
  studiedCards: number;

  @ApiProperty({ description: 'Cards in (re)learning' })
  learningCards: number;

  @ApiProperty({
    description: 'Well-known cards: in review with an interval of 21+ days',
  })
  matureCards: number;

  @ApiProperty({ description: 'Cards due now' })
  dueCards: number;

  @ApiProperty()
  totalReviews: number;

  @ApiProperty({ description: "Reviews since the user's local midnight" })
  reviewsToday: number;

  @ApiProperty({
    type: Number,
    nullable: true,
    description:
      'Share of correct answers over the last 30 days (0–1); null without reviews',
  })
  accuracy30d: number | null;

  @ApiProperty({
    description: 'Consecutive study days ending today (or yesterday)',
  })
  currentStreak: number;

  @ApiProperty()
  longestStreak: number;

  @ApiProperty()
  studiedToday: boolean;
}

export class HeatmapQueryDto {
  @ApiPropertyOptional({
    example: '2025-10-12',
    description: 'Local date; default 364 days before `to`',
  })
  @IsOptional()
  @Matches(DATE, { message: 'from must be YYYY-MM-DD' })
  from?: string;

  @ApiPropertyOptional({
    example: '2026-10-11',
    description: 'Local date; default today',
  })
  @IsOptional()
  @Matches(DATE, { message: 'to must be YYYY-MM-DD' })
  to?: string;
}

export class HeatmapDayDto {
  @ApiProperty({ example: '2026-10-11' })
  date: string;

  @ApiProperty()
  count: number;
}

export class HeatmapDto {
  @ApiProperty({ example: '2025-10-12' })
  from: string;

  @ApiProperty({ example: '2026-10-11' })
  to: string;

  @ApiProperty({
    type: [HeatmapDayDto],
    description: 'Only days with reviews, ascending',
  })
  days: HeatmapDayDto[];

  @ApiProperty()
  total: number;
}

export class ForecastQueryDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 365, default: 30 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  days: number = 30;
}

export class ForecastDayDto {
  @ApiProperty({ example: '2026-10-11' })
  date: string;

  @ApiProperty({
    description: 'Cards due that day (today includes overdue cards)',
  })
  count: number;
}

export class ForecastDto {
  @ApiProperty({
    type: [ForecastDayDto],
    description: 'One entry per day starting today',
  })
  days: ForecastDayDto[];
}

import { Injectable } from '@nestjs/common';
import {
  createEmptyCard,
  fsrs,
  Rating as FsrsRating,
  State as FsrsState,
  type Card as FsrsCard,
  type Grade,
} from 'ts-fsrs';
import type { CardProgress } from '../generated/prisma/client.js';
import type { CardState, Rating } from '../generated/prisma/enums.js';

/** The scheduling columns of CardProgress. */
export type SchedulingFields = Pick<
  CardProgress,
  | 'state'
  | 'due'
  | 'stability'
  | 'difficulty'
  | 'scheduledDays'
  | 'learningSteps'
  | 'reps'
  | 'lapses'
  | 'lastReview'
>;

export const RATINGS: Rating[] = ['AGAIN', 'HARD', 'GOOD', 'EASY'];

const TO_FSRS_STATE: Record<CardState, FsrsState> = {
  NEW: FsrsState.New,
  LEARNING: FsrsState.Learning,
  REVIEW: FsrsState.Review,
  RELEARNING: FsrsState.Relearning,
};
const FROM_FSRS_STATE: Record<FsrsState, CardState> = {
  [FsrsState.New]: 'NEW',
  [FsrsState.Learning]: 'LEARNING',
  [FsrsState.Review]: 'REVIEW',
  [FsrsState.Relearning]: 'RELEARNING',
};
const TO_FSRS_RATING: Record<Rating, Grade> = {
  AGAIN: FsrsRating.Again,
  HARD: FsrsRating.Hard,
  GOOD: FsrsRating.Good,
  EASY: FsrsRating.Easy,
};

/**
 * Thin wrapper over ts-fsrs (FSRS v6 defaults, 90% target retention, interval fuzz on).
 * Keeps the library's types out of the rest of the code base.
 */
@Injectable()
export class Scheduler {
  private readonly fsrs = fsrs({ request_retention: 0.9, enable_fuzz: true });

  /** Scheduling state of a card the user has never studied. */
  initial(now: Date): SchedulingFields {
    return fromFsrs(createEmptyCard(now));
  }

  /** New scheduling state after answering with `rating` at `now`. */
  next(current: SchedulingFields, rating: Rating, now: Date): SchedulingFields {
    return fromFsrs(
      this.fsrs.next(toFsrs(current), now, TO_FSRS_RATING[rating]).card,
    );
  }

  /** When the card would next be due for each possible rating (for the flip-card buttons). */
  preview(current: SchedulingFields, now: Date): Record<Rating, Date> {
    const outcomes = this.fsrs.repeat(toFsrs(current), now);
    return Object.fromEntries(
      RATINGS.map((rating) => [
        rating,
        outcomes[TO_FSRS_RATING[rating]].card.due,
      ]),
    ) as Record<Rating, Date>;
  }
}

function toFsrs(fields: SchedulingFields): FsrsCard {
  return {
    due: fields.due,
    stability: fields.stability,
    difficulty: fields.difficulty,
    elapsed_days: 0, // derived from last_review by ts-fsrs v5+
    scheduled_days: fields.scheduledDays,
    learning_steps: fields.learningSteps,
    reps: fields.reps,
    lapses: fields.lapses,
    state: TO_FSRS_STATE[fields.state],
    last_review: fields.lastReview ?? undefined,
  };
}

function fromFsrs(card: FsrsCard): SchedulingFields {
  return {
    state: FROM_FSRS_STATE[card.state],
    due: card.due,
    stability: card.stability,
    difficulty: card.difficulty,
    scheduledDays: card.scheduled_days,
    learningSteps: card.learning_steps,
    reps: card.reps,
    lapses: card.lapses,
    lastReview: card.last_review ?? null,
  };
}

import { addDays, daysBetween } from '../study/day.js';

export interface Streaks {
  /** Consecutive study days ending today, or yesterday if today has no reviews yet. */
  current: number;
  longest: number;
}

/**
 * @param studyDays distinct local dates ("YYYY-MM-DD") with at least one review, ascending
 * @param today the user's local date
 */
export function computeStreaks(studyDays: string[], today: string): Streaks {
  let longest = 0;
  let run = 0;
  let previous: string | undefined;
  for (const day of studyDays) {
    run = previous && daysBetween(previous, day) === 1 ? run + 1 : 1;
    longest = Math.max(longest, run);
    previous = day;
  }

  // The streak is still alive if the last study day is today or yesterday.
  const last = studyDays.at(-1);
  const alive = last === today || last === addDays(today, -1);
  return { current: alive ? run : 0, longest };
}

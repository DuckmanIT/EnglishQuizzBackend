import type { Rating } from '../generated/prisma/enums.js';

/**
 * Normalizes an answer for comparison: Unicode NFC (so "ế" typed as e + combining marks matches),
 * lower case, surrounding punctuation removed, inner whitespace collapsed.
 * Diacritics are kept on purpose: "ban" and "bán" are different words.
 */
export function normalizeAnswer(value: string): string {
  return value
    .normalize('NFC')
    .toLowerCase()
    .replace(/[.,!?;:"“”'‘’()[\]{}…]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function levenshtein(a: string, b: string): number {
  const x = [...a];
  const y = [...b];
  let previous = Array.from({ length: y.length + 1 }, (_, j) => j);
  for (let i = 1; i <= x.length; i++) {
    const current = [i];
    for (let j = 1; j <= y.length; j++) {
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous[y.length];
}

/** Typos tolerated before a typed answer counts as wrong: none for short words, up to 2 for long ones. */
export function typoTolerance(expected: string): number {
  const length = [...expected].length;
  if (length <= 4) return 0;
  if (length <= 8) return 1;
  return 2;
}

export interface GradedAnswer {
  correct: boolean;
  rating: Rating;
  /** Edit distance to the expected answer (typed modes only). */
  distance?: number;
}

/** Dictation / type-answer: exact → GOOD, small typo → HARD (still counted correct), else AGAIN. */
export function gradeTyped(answer: string, expected: string): GradedAnswer {
  const a = normalizeAnswer(answer);
  const e = normalizeAnswer(expected);
  const distance = levenshtein(a, e);
  if (distance === 0) return { correct: true, rating: 'GOOD', distance };
  if (a.length > 0 && distance <= typoTolerance(e)) {
    return { correct: true, rating: 'HARD', distance };
  }
  return { correct: false, rating: 'AGAIN', distance };
}

/** Answers this fast in multiple-choice/match are rated EASY instead of GOOD. */
export const FAST_ANSWER_MS = 3000;

/** Multiple choice / match: the chosen option must equal the expected text. */
export function gradeChoice(
  answer: string,
  expected: string,
  durationMs?: number,
): GradedAnswer {
  if (normalizeAnswer(answer) !== normalizeAnswer(expected)) {
    return { correct: false, rating: 'AGAIN' };
  }
  const fast = durationMs !== undefined && durationMs < FAST_ANSWER_MS;
  return { correct: true, rating: fast ? 'EASY' : 'GOOD' };
}

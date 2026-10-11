import {
  gradeChoice,
  gradeTyped,
  levenshtein,
  normalizeAnswer,
  typoTolerance,
} from './answer-check.js';

describe('normalizeAnswer', () => {
  it('ignores case, surrounding punctuation and extra spaces', () => {
    expect(normalizeAnswer('  Good   Morning! ')).toBe('good morning');
    expect(normalizeAnswer('“don’t”')).toBe('don t');
  });

  it('treats composed and decomposed Vietnamese the same, but keeps diacritics', () => {
    const decomposed = 'quả táo'.normalize('NFD');
    expect(normalizeAnswer(decomposed)).toBe(normalizeAnswer('quả táo'));
    expect(normalizeAnswer('ban')).not.toBe(normalizeAnswer('bán'));
  });
});

describe('levenshtein', () => {
  it.each([
    ['', '', 0],
    ['abc', '', 3],
    ['kitten', 'sitting', 3],
    ['táo', 'tao', 1],
  ])('%s → %s = %i', (a, b, d) => {
    expect(levenshtein(a, b)).toBe(d);
  });
});

describe('gradeTyped', () => {
  it('rates an exact answer GOOD', () => {
    expect(gradeTyped('Apple', 'apple')).toEqual({
      correct: true,
      rating: 'GOOD',
      distance: 0,
    });
  });

  it('accepts a small typo as HARD on longer words', () => {
    expect(gradeTyped('enviroment', 'environment')).toMatchObject({
      correct: true,
      rating: 'HARD',
      distance: 1,
    });
  });

  it('allows no typo on short words', () => {
    expect(typoTolerance('cat')).toBe(0);
    expect(gradeTyped('cut', 'cat')).toMatchObject({
      correct: false,
      rating: 'AGAIN',
    });
  });

  it('rates a wrong or empty answer AGAIN', () => {
    expect(gradeTyped('banana', 'apple')).toMatchObject({
      correct: false,
      rating: 'AGAIN',
    });
    expect(gradeTyped('', 'a')).toMatchObject({
      correct: false,
      rating: 'AGAIN',
    });
  });
});

describe('gradeChoice', () => {
  it('rates a correct choice GOOD, or EASY when answered fast', () => {
    expect(gradeChoice('con mèo', 'con mèo', 8000)).toEqual({
      correct: true,
      rating: 'GOOD',
    });
    expect(gradeChoice('con mèo', 'con mèo', 1200)).toEqual({
      correct: true,
      rating: 'EASY',
    });
    expect(gradeChoice('con mèo', 'con mèo')).toEqual({
      correct: true,
      rating: 'GOOD',
    });
  });

  it('rates a wrong choice AGAIN', () => {
    expect(gradeChoice('con chó', 'con mèo', 500)).toEqual({
      correct: false,
      rating: 'AGAIN',
    });
  });
});

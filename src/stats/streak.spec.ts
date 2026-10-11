import { addDays, daysBetween, localDate } from '../study/day.js';
import { computeStreaks } from './streak.js';

describe('computeStreaks', () => {
  const today = '2026-10-11';

  it('is zero with no study days', () => {
    expect(computeStreaks([], today)).toEqual({ current: 0, longest: 0 });
  });

  it('counts consecutive days ending today', () => {
    expect(
      computeStreaks(['2026-10-09', '2026-10-10', '2026-10-11'], today),
    ).toEqual({
      current: 3,
      longest: 3,
    });
  });

  it('keeps the streak alive until the end of today if yesterday was studied', () => {
    expect(computeStreaks(['2026-10-09', '2026-10-10'], today).current).toBe(2);
  });

  it('breaks the current streak after a missed day but remembers the longest', () => {
    expect(
      computeStreaks(
        ['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-10-08'],
        today,
      ),
    ).toEqual({ current: 0, longest: 4 });
  });

  it('crosses month and year boundaries', () => {
    expect(
      computeStreaks(['2025-12-31', '2026-01-01'], '2026-01-01').current,
    ).toBe(2);
  });
});

describe('date helpers', () => {
  it('gives the local calendar date in a time zone', () => {
    const instant = new Date('2026-10-10T18:30:00Z'); // 01:30 on the 11th in Vietnam
    expect(localDate(instant, 'Asia/Ho_Chi_Minh')).toBe('2026-10-11');
    expect(localDate(instant, 'Europe/Paris')).toBe('2026-10-10');
  });

  it('adds days and measures distances across month ends', () => {
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
    expect(daysBetween('2026-10-01', '2026-10-31')).toBe(30);
  });
});

import { startOfDayInTimeZone } from './day.js';

describe('startOfDayInTimeZone', () => {
  it('returns local midnight in Vietnam (UTC+7)', () => {
    // 2026-10-11 05:30 UTC = 12:30 in Ho Chi Minh City → midnight was 2026-10-10 17:00 UTC.
    const start = startOfDayInTimeZone(
      new Date('2026-10-11T05:30:00Z'),
      'Asia/Ho_Chi_Minh',
    );
    expect(start.toISOString()).toBe('2026-10-10T17:00:00.000Z');
  });

  it('uses the local date, not the UTC date, just after local midnight', () => {
    // 2026-10-10 17:30 UTC is already 00:30 on 2026-10-11 in Vietnam.
    const start = startOfDayInTimeZone(
      new Date('2026-10-10T17:30:00Z'),
      'Asia/Ho_Chi_Minh',
    );
    expect(start.toISOString()).toBe('2026-10-10T17:00:00.000Z');
  });

  it('handles zones behind UTC and daylight saving time', () => {
    // Paris in summer is UTC+2.
    expect(
      startOfDayInTimeZone(
        new Date('2026-07-01T10:00:00Z'),
        'Europe/Paris',
      ).toISOString(),
    ).toBe('2026-06-30T22:00:00.000Z');
    // New York in winter is UTC-5.
    expect(
      startOfDayInTimeZone(
        new Date('2026-01-15T03:00:00Z'),
        'America/New_York',
      ).toISOString(),
    ).toBe('2026-01-14T05:00:00.000Z');
  });
});

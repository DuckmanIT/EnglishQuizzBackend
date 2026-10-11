/**
 * The UTC instant of the most recent local midnight in `timeZone`.
 * Used for "new cards introduced today", so the daily limit resets at the user's midnight.
 */
export function startOfDayInTimeZone(now: Date, timeZone: string): Date {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
      .formatToParts(now)
      .map((part) => [part.type, Number(part.value)]),
  ) as Record<'year' | 'month' | 'day' | 'hour' | 'minute' | 'second', number>;

  // Offset of the zone from UTC at `now`, from the wall-clock time it shows.
  const wallClockAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  const offsetMs = wallClockAsUtc - Math.floor(now.getTime() / 1000) * 1000;
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day) - offsetMs);
}

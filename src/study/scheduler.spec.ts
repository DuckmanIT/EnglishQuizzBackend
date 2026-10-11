import { Scheduler } from './scheduler.js';

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

describe('Scheduler', () => {
  const scheduler = new Scheduler();
  const now = new Date('2026-10-11T08:00:00Z');

  it('starts new cards as NEW and due now', () => {
    expect(scheduler.initial(now)).toMatchObject({
      state: 'NEW',
      reps: 0,
      due: now,
    });
  });

  it('keeps a failed new card in short-term learning', () => {
    const next = scheduler.next(scheduler.initial(now), 'AGAIN', now);
    expect(next.state).toBe('LEARNING');
    expect(next.due.getTime() - now.getTime()).toBeLessThan(DAY);
    expect(next.reps).toBe(1);
    expect(next.lastReview).toEqual(now);
  });

  it('graduates an EASY new card straight to review, days away', () => {
    const next = scheduler.next(scheduler.initial(now), 'EASY', now);
    expect(next.state).toBe('REVIEW');
    expect(next.due.getTime() - now.getTime()).toBeGreaterThanOrEqual(DAY);
  });

  it('orders the preview intervals AGAIN ≤ HARD ≤ GOOD ≤ EASY', () => {
    const preview = scheduler.preview(scheduler.initial(now), now);
    const times = (['AGAIN', 'HARD', 'GOOD', 'EASY'] as const).map((r) =>
      preview[r].getTime(),
    );
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });

  it('grows intervals with successful reviews and counts a lapse when forgotten', () => {
    let card = scheduler.next(scheduler.initial(now), 'GOOD', now);
    let at = now;
    while (card.state !== 'REVIEW') {
      at = card.due;
      card = scheduler.next(card, 'GOOD', at);
    }
    const firstInterval = card.due.getTime() - at.getTime();

    at = card.due;
    card = scheduler.next(card, 'GOOD', at);
    expect(card.due.getTime() - at.getTime()).toBeGreaterThan(firstInterval);

    at = card.due;
    card = scheduler.next(card, 'AGAIN', at);
    expect(card).toMatchObject({ state: 'RELEARNING', lapses: 1 });
    expect(card.due.getTime() - at.getTime()).toBeLessThan(DAY);
  });
});

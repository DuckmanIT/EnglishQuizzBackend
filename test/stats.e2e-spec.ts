import request from 'supertest';
import { startOfDayInTimeZone } from '../src/study/day.js';
import {
  createTestApp,
  loginAs,
  resetDatabase,
  type TestApp,
} from './helpers.js';

const ALICE = { sub: 'alice', email: 'alice@example.com' };
const BOB = { sub: 'bob', email: 'bob@example.com' };
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const VN = 'Asia/Ho_Chi_Minh';

describe('Stats (e2e)', () => {
  let t: TestApp;
  let alice: { userId: string; auth: string };
  let bob: { userId: string; auth: string };
  let cardIds: string[];
  const get = (path: string, auth = alice.auth) =>
    request(t.app.getHttpServer())
      .get(`/api/v1/stats${path}`)
      .set('Authorization', auth);

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(async () => {
    await t.app.close();
  });

  beforeEach(async () => {
    await resetDatabase(t.prisma);
    alice = await loginAs(t, ALICE);
    bob = await loginAs(t, BOB);
    const deck = await t.prisma.deck.create({
      data: {
        ownerId: alice.userId,
        title: 'Words',
        frontLang: 'en',
        backLang: 'vi',
        cardCount: 6,
        cards: {
          create: Array.from({ length: 6 }, (_, i) => ({
            term: `w${i}`,
            definition: `d${i}`,
            position: i,
          })),
        },
      },
      include: { cards: { orderBy: { position: 'asc' } } },
    });
    cardIds = deck.cards.map((c) => c.id);
  });

  const review = (reviewedAt: Date, correct = true, userId = alice.userId) =>
    t.prisma.reviewLog.create({
      data: {
        userId,
        cardId: cardIds[0],
        mode: 'FLIP',
        rating: correct ? 'GOOD' : 'AGAIN',
        correct,
        reviewedAt,
      },
    });

  const progress = (
    cardId: string,
    data: { state?: 'LEARNING' | 'REVIEW'; due: Date; scheduledDays?: number },
    userId = alice.userId,
  ) =>
    t.prisma.cardProgress.create({
      data: {
        userId,
        cardId,
        state: data.state ?? 'REVIEW',
        due: data.due,
        scheduledDays: data.scheduledDays ?? 1,
      },
    });

  /** A moment ago: always "today" for any time zone, except in the first second after midnight. */
  const justNow = () => new Date(Date.now() - 1000);

  /** Local noon `daysFromToday` days away, in Alice's time zone. */
  const localNoon = (daysFromToday: number) =>
    new Date(
      startOfDayInTimeZone(new Date(), VN).getTime() +
        daysFromToday * DAY +
        12 * HOUR,
    );

  describe('GET /stats/overview', () => {
    it('is empty for a new user', async () => {
      const res = await get('/overview').expect(200);
      expect(res.body).toEqual({
        studiedCards: 0,
        learningCards: 0,
        matureCards: 0,
        dueCards: 0,
        totalReviews: 0,
        reviewsToday: 0,
        accuracy30d: null,
        currentStreak: 0,
        longestStreak: 0,
        studiedToday: false,
      });
    });

    it('summarises cards, reviews, accuracy and streaks', async () => {
      await progress(cardIds[0], {
        state: 'LEARNING',
        due: new Date(Date.now() - HOUR),
      });
      await progress(cardIds[1], { due: localNoon(10), scheduledDays: 30 }); // mature
      await progress(cardIds[2], {
        due: new Date(Date.now() - DAY),
        scheduledDays: 3,
      });

      // Studied today (3x, 2 correct), yesterday and the day before → streak 3.
      await review(justNow());
      await review(justNow());
      await review(justNow(), false);
      await review(localNoon(-1));
      await review(localNoon(-2));
      // An older 4-day streak.
      for (const d of [-20, -19, -18, -17]) await review(localNoon(d), false);
      // A review from 40 days ago is outside the accuracy window.
      await review(localNoon(-40), false);
      // Bob's activity never counts for Alice.
      await review(localNoon(0), true, bob.userId);

      const res = await get('/overview').expect(200);
      expect(res.body).toMatchObject({
        studiedCards: 3,
        learningCards: 1,
        matureCards: 1,
        dueCards: 2,
        totalReviews: 10,
        currentStreak: 3,
        longestStreak: 4,
        studiedToday: true,
      });
      // Last 30 days: 4 correct out of 9 (the 40-day-old one excluded).
      expect(res.body.accuracy30d).toBeCloseTo(4 / 9, 3);
      expect(res.body.reviewsToday).toBe(3);
    });
  });

  describe('GET /stats/heatmap', () => {
    it("buckets reviews by the user's local date, not the UTC date", async () => {
      await review(new Date('2026-03-10T16:30:00Z')); // 23:30 on the 10th in Vietnam
      await review(new Date('2026-03-10T17:30:00Z')); // 00:30 on the 11th in Vietnam
      await review(new Date('2026-03-10T17:45:00Z'));

      const vn = await get('/heatmap?from=2026-03-10&to=2026-03-11').expect(
        200,
      );
      expect(vn.body).toEqual({
        from: '2026-03-10',
        to: '2026-03-11',
        days: [
          { date: '2026-03-10', count: 1 },
          { date: '2026-03-11', count: 2 },
        ],
        total: 3,
      });

      // Same reviews seen from Paris (UTC+1 in March): all on the 10th.
      await t.prisma.user.update({
        where: { id: alice.userId },
        data: { timezone: 'Europe/Paris' },
      });
      const paris = await get('/heatmap?from=2026-03-10&to=2026-03-11').expect(
        200,
      );
      expect(paris.body.days).toEqual([{ date: '2026-03-10', count: 3 }]);
    });

    it('defaults to the last 365 days and excludes days outside the range', async () => {
      await review(localNoon(0));
      await review(localNoon(-364));
      await review(localNoon(-365)); // just outside
      const res = await get('/heatmap').expect(200);
      expect(res.body.total).toBe(2);
      expect(res.body.days).toHaveLength(2);
    });

    it('validates the range', async () => {
      const reversed = await get(
        '/heatmap?from=2026-03-11&to=2026-03-10',
      ).expect(400);
      expect(reversed.body.code).toBe('STATS_INVALID_RANGE');
      await get('/heatmap?from=2024-01-01&to=2026-01-01').expect(400);
      await get('/heatmap?from=11/03/2026').expect(400);
    });
  });

  describe('GET /stats/forecast', () => {
    it('counts cards coming due per local day, folding overdue cards into today', async () => {
      await progress(cardIds[0], { due: new Date(Date.now() - 2 * DAY) }); // overdue
      await progress(cardIds[1], { due: localNoon(0) });
      await progress(cardIds[2], { due: localNoon(1) });
      await progress(cardIds[3], { due: localNoon(1) });
      await progress(cardIds[4], { due: localNoon(6) });
      await progress(cardIds[5], { due: localNoon(7) }); // beyond a 7-day window

      const res = await get('/forecast?days=7').expect(200);
      expect(res.body.days).toHaveLength(7);
      expect(res.body.days.map((d: { count: number }) => d.count)).toEqual([
        2, 2, 0, 0, 0, 0, 1,
      ]);
      expect(res.body.days[1].date > res.body.days[0].date).toBe(true);
    });

    it("ignores cards in other users' private decks", async () => {
      const bobsDeck = await t.prisma.deck.create({
        data: {
          ownerId: bob.userId,
          title: 'Private',
          frontLang: 'en',
          backLang: 'vi',
          cards: { create: { term: 'x', definition: 'y', position: 0 } },
        },
        include: { cards: true },
      });
      await progress(bobsDeck.cards[0].id, { due: localNoon(1) });
      const res = await get('/forecast?days=3').expect(200);
      expect(res.body.days.every((d: { count: number }) => d.count === 0)).toBe(
        true,
      );
    });

    it('validates the window size', async () => {
      await get('/forecast?days=0').expect(400);
      await get('/forecast?days=366').expect(400);
    });
  });
});

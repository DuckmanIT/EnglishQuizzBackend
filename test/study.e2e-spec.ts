import request from 'supertest';
import {
  createTestApp,
  loginAs,
  resetDatabase,
  type TestApp,
} from './helpers.js';

const ALICE = { sub: 'alice', email: 'alice@example.com' };
const BOB = { sub: 'bob', email: 'bob@example.com' };
const WORDS = ['cat', 'dog', 'bird', 'fish', 'horse'];
const DAY = 24 * 60 * 60 * 1000;

interface Question {
  cardId: string;
  deckId: string;
  isNew: boolean;
  prompt: { text: string; speakText?: string; lang?: string };
  card?: { definition: string };
  previews?: Record<string, string>;
  choices?: string[];
  answerLength?: number;
}

describe('Study (e2e)', () => {
  let t: TestApp;
  let alice: { userId: string; auth: string };
  let bob: { userId: string; auth: string };
  const http = () => request(t.app.getHttpServer());

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
  });

  async function deckWith(
    ownerId: string | null,
    words = WORDS,
    extra: Record<string, unknown> = {},
  ) {
    return t.prisma.deck.create({
      data: {
        ownerId,
        title: `Deck ${Math.random()}`,
        frontLang: 'en',
        backLang: 'vi',
        cardCount: words.length,
        ...extra,
        cards: {
          create: words.map((term, position) => ({
            term,
            definition: `${term} (vi)`,
            position,
          })),
        },
      },
      include: { cards: { orderBy: { position: 'asc' } } },
    });
  }

  const session = (auth: string, body: Record<string, unknown>) =>
    http().post('/api/v1/study/sessions').set('Authorization', auth).send(body);

  const answer = (auth: string, body: Record<string, unknown>) =>
    http().post('/api/v1/study/answers').set('Authorization', auth).send(body);

  /** Gives Alice a progress row for `cardId` that is due `dueInMs` from now. */
  const progress = (
    cardId: string,
    dueInMs: number,
    state = 'REVIEW' as const,
  ) =>
    t.prisma.cardProgress.create({
      data: {
        userId: alice.userId,
        cardId,
        state,
        due: new Date(Date.now() + dueInMs),
        stability: 5,
        difficulty: 5,
        scheduledDays: 5,
        reps: 3,
        lastReview: new Date(Date.now() - 5 * DAY),
      },
    });

  describe('GET /study/queue', () => {
    it('serves new cards in deck order, capped by the daily new-card limit', async () => {
      const deck = await deckWith(alice.userId);
      await t.prisma.user.update({
        where: { id: alice.userId },
        data: { dailyNewLimit: 3 },
      });

      const res = await http()
        .get(`/api/v1/study/queue?deckId=${deck.id}`)
        .set('Authorization', alice.auth)
        .expect(200);

      expect(res.body.newRemainingToday).toBe(3);
      expect(res.body.dueCount).toBe(0);
      expect(
        res.body.items.map((i: { card: { term: string } }) => i.card.term),
      ).toEqual(['cat', 'dog', 'bird']);
      expect(res.body.items[0]).toMatchObject({
        isNew: true,
        state: 'NEW',
        due: null,
      });
    });

    it('puts due reviews first (oldest first), skips cards not yet due', async () => {
      const deck = await deckWith(alice.userId);
      const [cat, dog, bird] = deck.cards;
      await progress(cat.id, -1 * DAY);
      await progress(dog.id, -3 * DAY);
      await progress(bird.id, +2 * DAY); // not due

      const res = await http()
        .get(`/api/v1/study/queue?deckId=${deck.id}`)
        .set('Authorization', alice.auth)
        .expect(200);

      expect(res.body.dueCount).toBe(2);
      expect(
        res.body.items.map((i: { card: { term: string } }) => i.card.term),
      ).toEqual(['dog', 'cat', 'fish', 'horse']);
    });

    it('counts all due cards even when the page is smaller', async () => {
      const deck = await deckWith(alice.userId);
      for (const card of deck.cards) await progress(card.id, -DAY);
      const res = await http()
        .get(`/api/v1/study/queue?deckId=${deck.id}&limit=2`)
        .set('Authorization', alice.auth)
        .expect(200);
      expect(res.body.items).toHaveLength(2);
      expect(res.body.dueCount).toBe(5);
    });

    it('lets me study a system deck directly, without cloning it', async () => {
      const deck = await deckWith(null, WORDS, { source: 'SYSTEM' });
      const res = await http()
        .get(`/api/v1/study/queue?deckId=${deck.id}`)
        .set('Authorization', alice.auth)
        .expect(200);
      expect(res.body.items).toHaveLength(5);
    });

    it("hides other users' private decks", async () => {
      const deck = await deckWith(bob.userId);
      await http()
        .get(`/api/v1/study/queue?deckId=${deck.id}`)
        .set('Authorization', alice.auth)
        .expect(404);
    });

    it('across decks: due cards from decks I study, new cards from my decks and decks I started', async () => {
      await deckWith(alice.userId, ['one']);
      const bobsPublic = await deckWith(bob.userId, ['pub1', 'pub2'], {
        visibility: 'PUBLIC',
      });
      const untouchedPublic = await deckWith(bob.userId, ['nope'], {
        visibility: 'PUBLIC',
      });
      await progress(bobsPublic.cards[0].id, -DAY);

      const res = await http()
        .get('/api/v1/study/queue')
        .set('Authorization', alice.auth)
        .expect(200);
      const terms = res.body.items.map(
        (i: { card: { term: string } }) => i.card.term,
      );
      expect(terms[0]).toBe('pub1'); // due first
      expect(terms).toEqual(expect.arrayContaining(['one', 'pub2']));
      expect(terms).not.toContain(untouchedPublic.cards[0].term);
    });
  });

  describe('sessions and answers', () => {
    it('FLIP: returns the card with rating previews; the answer schedules the card', async () => {
      const deck = await deckWith(alice.userId);
      const res = await session(alice.auth, {
        deckId: deck.id,
        mode: 'FLIP',
        limit: 2,
      }).expect(200);
      const q: Question = res.body.questions[0];

      expect(res.body.questions).toHaveLength(2);
      expect(q.prompt.text).toBe('cat');
      expect(q.card?.definition).toBe('cat (vi)');
      expect(Object.keys(q.previews ?? {})).toEqual([
        'AGAIN',
        'HARD',
        'GOOD',
        'EASY',
      ]);

      const missing = await answer(alice.auth, {
        cardId: q.cardId,
        mode: 'FLIP',
      }).expect(400);
      expect(missing.body.code).toBe('STUDY_RATING_REQUIRED');

      const result = await answer(alice.auth, {
        cardId: q.cardId,
        mode: 'FLIP',
        rating: 'GOOD',
        durationMs: 4200,
      }).expect(200);
      expect(result.body).toMatchObject({
        correct: true,
        rating: 'GOOD',
        expected: 'cat (vi)',
        state: expect.stringMatching(/LEARNING|REVIEW/),
      });
      expect(new Date(result.body.due).getTime()).toBeGreaterThan(Date.now());

      const log = await t.prisma.reviewLog.findFirstOrThrow({
        where: { cardId: q.cardId },
      });
      expect(log).toMatchObject({
        prevState: 'NEW',
        rating: 'GOOD',
        mode: 'FLIP',
        durationMs: 4200,
      });
      const row = await t.prisma.cardProgress.findUniqueOrThrow({
        where: { userId_cardId: { userId: alice.userId, cardId: q.cardId } },
      });
      expect(row.reps).toBe(1);
    });

    it('MULTIPLE_CHOICE: four distinct options including the right one, and no answer key', async () => {
      const deck = await deckWith(alice.userId);
      const res = await session(alice.auth, {
        deckId: deck.id,
        mode: 'MULTIPLE_CHOICE',
        limit: 1,
      }).expect(200);
      const q: Question = res.body.questions[0];

      expect(q.prompt.text).toBe('cat');
      expect(q.choices).toHaveLength(4);
      expect(new Set(q.choices).size).toBe(4);
      expect(q.choices).toContain('cat (vi)');
      expect(q.card).toBeUndefined();
      expect(q.previews).toBeUndefined();

      const fast = await answer(alice.auth, {
        cardId: q.cardId,
        mode: 'MULTIPLE_CHOICE',
        answer: 'cat (vi)',
        durationMs: 1500,
      }).expect(200);
      expect(fast.body).toMatchObject({ correct: true, rating: 'EASY' });
    });

    it('MULTIPLE_CHOICE: a wrong choice is rated AGAIN and reveals the answer', async () => {
      const deck = await deckWith(alice.userId);
      const res = await answer(alice.auth, {
        cardId: deck.cards[0].id,
        mode: 'MULTIPLE_CHOICE',
        answer: 'dog (vi)',
      }).expect(200);
      expect(res.body).toMatchObject({
        correct: false,
        rating: 'AGAIN',
        expected: 'cat (vi)',
        state: 'LEARNING',
      });
    });

    it('MULTIPLE_CHOICE: small decks get fewer options', async () => {
      const deck = await deckWith(alice.userId, ['yes', 'no']);
      const res = await session(alice.auth, {
        deckId: deck.id,
        mode: 'MULTIPLE_CHOICE',
      }).expect(200);
      expect(res.body.questions[0].choices).toHaveLength(2);
    });

    it('requires an answer for non-FLIP modes', async () => {
      const deck = await deckWith(alice.userId);
      const res = await answer(alice.auth, {
        cardId: deck.cards[0].id,
        mode: 'TYPE_ANSWER',
      }).expect(400);
      expect(res.body.code).toBe('STUDY_ANSWER_REQUIRED');
    });

    it('TYPE_ANSWER: prompts with the definition and tolerates a small typo', async () => {
      const deck = await deckWith(alice.userId, ['environment']);
      const res = await session(alice.auth, {
        deckId: deck.id,
        mode: 'TYPE_ANSWER',
      }).expect(200);
      const q: Question = res.body.questions[0];
      expect(q.prompt.text).toBe('environment (vi)');
      expect(q.answerLength).toBe(11);

      const result = await answer(alice.auth, {
        cardId: q.cardId,
        mode: 'TYPE_ANSWER',
        answer: 'Enviroment',
      }).expect(200);
      expect(result.body).toMatchObject({
        correct: true,
        rating: 'HARD',
        distance: 1,
        expected: 'environment',
      });
    });

    it('DICTATION: without recorded audio, gives text for speech synthesis', async () => {
      const deck = await deckWith(alice.userId, ['horse']);
      const res = await session(alice.auth, {
        deckId: deck.id,
        mode: 'DICTATION',
      }).expect(200);
      expect(res.body.questions[0].prompt).toMatchObject({
        text: 'horse (vi)',
        speakText: 'horse',
        lang: 'en',
      });
    });

    it('MATCH: prompts with terms and gives all definitions shuffled', async () => {
      const deck = await deckWith(alice.userId);
      const res = await session(alice.auth, {
        deckId: deck.id,
        mode: 'MATCH',
      }).expect(200);
      expect(res.body.questions.map((q: Question) => q.prompt.text)).toEqual(
        WORDS,
      );
      expect(res.body.matchChoices).toHaveLength(WORDS.length);
      expect(res.body.matchChoices).toEqual(
        expect.arrayContaining(WORDS.map((w) => `${w} (vi)`)),
      );
    });

    it("refuses answers for cards in others' private decks", async () => {
      const deck = await deckWith(bob.userId);
      const res = await answer(alice.auth, {
        cardId: deck.cards[0].id,
        mode: 'FLIP',
        rating: 'GOOD',
      }).expect(404);
      expect(res.body.code).toBe('CARD_NOT_FOUND');
    });

    it('a learned card leaves the queue and new cards studied today use up the daily limit', async () => {
      const deck = await deckWith(alice.userId);
      await t.prisma.user.update({
        where: { id: alice.userId },
        data: { dailyNewLimit: 2 },
      });

      await answer(alice.auth, {
        cardId: deck.cards[0].id,
        mode: 'FLIP',
        rating: 'EASY',
      }).expect(200);

      const res = await http()
        .get(`/api/v1/study/queue?deckId=${deck.id}`)
        .set('Authorization', alice.auth)
        .expect(200);
      expect(res.body.newRemainingToday).toBe(1);
      expect(
        res.body.items.map((i: { card: { term: string } }) => i.card.term),
      ).toEqual(['dog']);
    });

    it("resets the daily new-card allowance at the user's local midnight", async () => {
      const deck = await deckWith(alice.userId);
      await t.prisma.user.update({
        where: { id: alice.userId },
        data: { dailyNewLimit: 2 },
      });
      // A new card studied 2 days ago doesn't count against today.
      await t.prisma.reviewLog.create({
        data: {
          userId: alice.userId,
          cardId: deck.cards[0].id,
          mode: 'FLIP',
          prevState: 'NEW',
          rating: 'GOOD',
          correct: true,
          reviewedAt: new Date(Date.now() - 2 * DAY),
        },
      });
      const res = await http()
        .get(`/api/v1/study/queue?deckId=${deck.id}`)
        .set('Authorization', alice.auth)
        .expect(200);
      expect(res.body.newRemainingToday).toBe(2);
    });
  });

  describe('GET /study/summary', () => {
    it('lists due and new counts per deck I own or study', async () => {
      const mine = await deckWith(alice.userId);
      const system = await deckWith(null, ['hello', 'bye'], {
        source: 'SYSTEM',
      });
      await deckWith(null, ['never'], { source: 'SYSTEM' }); // not started → not listed
      await progress(mine.cards[0].id, -DAY);
      await progress(mine.cards[1].id, +DAY);
      await progress(system.cards[0].id, -DAY);
      await progress(system.cards[1].id, -2 * DAY);

      const res = await http()
        .get('/api/v1/study/summary')
        .set('Authorization', alice.auth)
        .expect(200);

      expect(res.body.totalDue).toBe(3);
      expect(res.body.newRemainingToday).toBe(20);
      expect(res.body.decks).toEqual([
        { deckId: system.id, title: system.title, dueCount: 2, newCount: 0 },
        { deckId: mine.id, title: mine.title, dueCount: 1, newCount: 3 },
      ]);
    });
  });
});

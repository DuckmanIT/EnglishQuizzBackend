import request from 'supertest';
import {
  createTestApp,
  loginAs,
  resetDatabase,
  type TestApp,
} from './helpers.js';

const ALICE = { sub: 'alice', email: 'alice@example.com' };
const BOB = { sub: 'bob', email: 'bob@example.com' };
const MISSING_ID = '00000000-0000-4000-8000-000000000000';

describe('Decks & cards (e2e)', () => {
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

  async function createDeck(auth: string, body: Record<string, unknown> = {}) {
    const res = await http()
      .post('/api/v1/decks')
      .set('Authorization', auth)
      .send({ title: 'Animals', frontLang: 'en', backLang: 'vi', ...body })
      .expect(201);
    return res.body as { id: string; [key: string]: unknown };
  }

  async function addCards(auth: string, deckId: string, terms: string[]) {
    const res = await http()
      .post(`/api/v1/decks/${deckId}/cards`)
      .set('Authorization', auth)
      .send({
        cards: terms.map((term) => ({ term, definition: `${term} (vi)` })),
      })
      .expect(201);
    return res.body as { id: string; position: number }[];
  }

  async function systemDeck(terms: string[]) {
    return t.prisma.deck.create({
      data: {
        title: 'TOEIC 600 – Unit 1',
        frontLang: 'en',
        backLang: 'vi',
        source: 'SYSTEM',
        cardCount: terms.length,
        cards: {
          create: terms.map((term, position) => ({
            term,
            definition: `${term} (vi)`,
            position,
          })),
        },
      },
    });
  }

  describe('CRUD', () => {
    it('creates a private deck owned by the caller', async () => {
      const deck = await createDeck(alice.auth, {
        description: '  Zoo words  ',
      });
      expect(deck).toMatchObject({
        title: 'Animals',
        description: 'Zoo words',
        frontLang: 'en',
        backLang: 'vi',
        source: 'USER',
        visibility: 'PRIVATE',
        cardCount: 0,
        isOwner: true,
      });
    });

    it.each([
      [{ title: '   ' }],
      [{ frontLang: 'english' }],
      [{ source: 'SYSTEM' }], // cannot create system decks
      [{ coverUrl: 'http://insecure.example.com/a.png' }],
    ])('rejects invalid deck %j', async (body) => {
      await http()
        .post('/api/v1/decks')
        .set('Authorization', alice.auth)
        .send({ title: 'Animals', frontLang: 'en', backLang: 'vi', ...body })
        .expect(400);
    });

    it('lists only my decks, with search, language filter and pagination', async () => {
      await createDeck(alice.auth, { title: 'Animals' });
      await createDeck(alice.auth, { title: 'Wild animals' });
      await createDeck(alice.auth, { title: 'Kanji N5', frontLang: 'ja' });
      await createDeck(bob.auth, { title: 'Bob animals' });

      const all = await http()
        .get('/api/v1/decks')
        .set('Authorization', alice.auth)
        .expect(200);
      expect(all.body.total).toBe(3);

      const search = await http()
        .get('/api/v1/decks?q=ANIMAL&pageSize=1&page=2')
        .set('Authorization', alice.auth)
        .expect(200);
      expect(search.body).toMatchObject({ total: 2, page: 2, pageSize: 1 });
      expect(search.body.items).toHaveLength(1);

      const ja = await http()
        .get('/api/v1/decks?frontLang=ja')
        .set('Authorization', alice.auth)
        .expect(200);
      expect(ja.body.items.map((d: { title: string }) => d.title)).toEqual([
        'Kanji N5',
      ]);

      await http()
        .get('/api/v1/decks?pageSize=500')
        .set('Authorization', alice.auth)
        .expect(400);
    });

    it('updates and deletes my deck, cascading to its cards', async () => {
      const deck = await createDeck(alice.auth);
      await addCards(alice.auth, deck.id, ['cat', 'dog']);

      const updated = await http()
        .patch(`/api/v1/decks/${deck.id}`)
        .set('Authorization', alice.auth)
        .send({ title: 'Pets', visibility: 'PUBLIC' })
        .expect(200);
      expect(updated.body).toMatchObject({
        title: 'Pets',
        visibility: 'PUBLIC',
      });

      await http()
        .delete(`/api/v1/decks/${deck.id}`)
        .set('Authorization', alice.auth)
        .expect(204);
      expect(await t.prisma.card.count()).toBe(0);
      await http()
        .get(`/api/v1/decks/${deck.id}`)
        .set('Authorization', alice.auth)
        .expect(404);
    });

    it('returns 400 for a malformed id and 404 for an unknown one', async () => {
      await http()
        .get('/api/v1/decks/not-a-uuid')
        .set('Authorization', alice.auth)
        .expect(400);
      const res = await http()
        .get(`/api/v1/decks/${MISSING_ID}`)
        .set('Authorization', alice.auth)
        .expect(404);
      expect(res.body.code).toBe('DECK_NOT_FOUND');
    });

    it("reports the caller's study progress on the deck", async () => {
      const deck = await createDeck(alice.auth);
      const cards = await addCards(alice.auth, deck.id, ['a', 'b', 'c', 'd']);
      const past = new Date(Date.now() - 60_000);
      const future = new Date(Date.now() + 86_400_000);
      await t.prisma.cardProgress.createMany({
        data: [
          {
            userId: alice.userId,
            cardId: cards[0].id,
            state: 'LEARNING',
            due: past,
          },
          {
            userId: alice.userId,
            cardId: cards[1].id,
            state: 'REVIEW',
            due: future,
          },
          {
            userId: bob.userId,
            cardId: cards[2].id,
            state: 'REVIEW',
            due: past,
          }, // not Alice's
        ],
      });

      const res = await http()
        .get(`/api/v1/decks/${deck.id}`)
        .set('Authorization', alice.auth)
        .expect(200);
      expect(res.body.progress).toEqual({
        newCount: 2,
        learningCount: 1,
        reviewCount: 1,
        dueCount: 1,
      });
    });
  });

  describe('access control', () => {
    it("hides other users' private decks entirely", async () => {
      const deck = await createDeck(bob.auth);
      const [card] = await addCards(bob.auth, deck.id, ['secret']);

      for (const req of [
        () => http().get(`/api/v1/decks/${deck.id}`),
        () => http().patch(`/api/v1/decks/${deck.id}`).send({ title: 'x' }),
        () => http().delete(`/api/v1/decks/${deck.id}`),
        () => http().post(`/api/v1/decks/${deck.id}/clone`),
        () => http().get(`/api/v1/decks/${deck.id}/cards`),
        () =>
          http()
            .post(`/api/v1/decks/${deck.id}/cards`)
            .send({ cards: [{ term: 'a', definition: 'b' }] }),
      ]) {
        const res = await req().set('Authorization', alice.auth).expect(404);
        expect(res.body.code).toBe('DECK_NOT_FOUND');
      }
      const cardRes = await http()
        .patch(`/api/v1/cards/${card.id}`)
        .set('Authorization', alice.auth)
        .send({ term: 'hacked' })
        .expect(404);
      expect(cardRes.body.code).toBe('CARD_NOT_FOUND');
    });

    it('lets others read a public deck but not change it', async () => {
      const deck = await createDeck(bob.auth, { visibility: 'PUBLIC' });
      const [card] = await addCards(bob.auth, deck.id, ['cat']);

      const read = await http()
        .get(`/api/v1/decks/${deck.id}`)
        .set('Authorization', alice.auth)
        .expect(200);
      expect(read.body.isOwner).toBe(false);
      await http()
        .get(`/api/v1/decks/${deck.id}/cards`)
        .set('Authorization', alice.auth)
        .expect(200);

      for (const req of [
        () => http().patch(`/api/v1/decks/${deck.id}`).send({ title: 'x' }),
        () => http().delete(`/api/v1/decks/${deck.id}`),
        () =>
          http()
            .post(`/api/v1/decks/${deck.id}/cards`)
            .send({ cards: [{ term: 'a', definition: 'b' }] }),
        () => http().patch(`/api/v1/cards/${card.id}`).send({ term: 'x' }),
        () => http().delete(`/api/v1/cards/${card.id}`),
      ]) {
        const res = await req().set('Authorization', alice.auth).expect(403);
        expect(res.body.code).toBe('DECK_FORBIDDEN');
      }
    });

    it('lets admins edit system decks, but not regular users', async () => {
      const deck = await systemDeck(['hello']);
      await http()
        .patch(`/api/v1/decks/${deck.id}`)
        .set('Authorization', alice.auth)
        .send({ title: 'x' })
        .expect(403);

      await t.prisma.user.update({
        where: { id: alice.userId },
        data: { role: 'ADMIN' },
      });
      const admin = await loginAs(t, ALICE); // role is carried in the access token
      const res = await http()
        .patch(`/api/v1/decks/${deck.id}`)
        .set('Authorization', admin.auth)
        .send({ title: 'TOEIC 600 – Unit 1 (2026)' })
        .expect(200);
      expect(res.body.isOwner).toBe(true);
    });
  });

  describe('POST /decks/:id/clone', () => {
    it('copies a system deck with its cards into a private deck of mine', async () => {
      const source = await systemDeck(['hello', 'goodbye', 'thanks']);
      const res = await http()
        .post(`/api/v1/decks/${source.id}/clone`)
        .set('Authorization', alice.auth)
        .expect(201);

      expect(res.body).toMatchObject({
        title: 'TOEIC 600 – Unit 1',
        source: 'USER',
        visibility: 'PRIVATE',
        cardCount: 3,
        isOwner: true,
      });
      expect(res.body.id).not.toBe(source.id);

      const cards = await http()
        .get(`/api/v1/decks/${res.body.id}/cards`)
        .set('Authorization', alice.auth)
        .expect(200);
      expect(cards.body.items.map((c: { term: string }) => c.term)).toEqual([
        'hello',
        'goodbye',
        'thanks',
      ]);

      // Editing the copy leaves the original untouched.
      await http()
        .patch(`/api/v1/cards/${cards.body.items[0].id}`)
        .set('Authorization', alice.auth)
        .send({ term: 'hi' })
        .expect(200);
      expect(
        (
          await t.prisma.card.findFirst({
            where: { deckId: source.id, position: 0 },
          })
        )?.term,
      ).toBe('hello');
    });
  });

  describe('cards', () => {
    it('appends cards in order and keeps the deck count in sync', async () => {
      const deck = await createDeck(alice.auth);
      const first = await addCards(alice.auth, deck.id, ['a', 'b']);
      const second = await addCards(alice.auth, deck.id, ['c']);
      expect([...first, ...second].map((c) => c.position)).toEqual([0, 1, 2]);

      const list = await http()
        .get(`/api/v1/decks/${deck.id}/cards?pageSize=2`)
        .set('Authorization', alice.auth)
        .expect(200);
      expect(list.body.total).toBe(3);
      expect(list.body.items.map((c: { term: string }) => c.term)).toEqual([
        'a',
        'b',
      ]);

      await http()
        .delete(`/api/v1/cards/${first[0].id}`)
        .set('Authorization', alice.auth)
        .expect(204);
      expect(
        (await t.prisma.deck.findUnique({ where: { id: deck.id } }))?.cardCount,
      ).toBe(2);
    });

    it('keeps positions unique under concurrent appends', async () => {
      const deck = await createDeck(alice.auth);
      await Promise.all(
        ['a', 'b', 'c', 'd', 'e'].map((term) =>
          addCards(alice.auth, deck.id, [term, `${term}2`]),
        ),
      );
      const cards = await t.prisma.card.findMany({
        where: { deckId: deck.id },
      });
      expect(new Set(cards.map((c) => c.position)).size).toBe(10);
      expect(
        (await t.prisma.deck.findUnique({ where: { id: deck.id } }))?.cardCount,
      ).toBe(10);
    });

    it('updates a card and clears optional fields sent as empty strings', async () => {
      const deck = await createDeck(alice.auth);
      const res = await http()
        .post(`/api/v1/decks/${deck.id}/cards`)
        .set('Authorization', alice.auth)
        .send({
          cards: [{ term: 'run', definition: 'chạy', phonetic: '/rʌn/' }],
        })
        .expect(201);

      const updated = await http()
        .patch(`/api/v1/cards/${res.body[0].id}`)
        .set('Authorization', alice.auth)
        .send({
          definition: 'chạy, điều hành',
          phonetic: '',
          example: 'I run.',
        })
        .expect(200);
      expect(updated.body).toMatchObject({
        term: 'run',
        definition: 'chạy, điều hành',
        phonetic: null,
        example: 'I run.',
      });
    });

    it('rejects invalid cards', async () => {
      const deck = await createDeck(alice.auth);
      for (const cards of [
        [],
        [{ term: 'only term' }],
        [{ term: 'x'.repeat(201), definition: 'd' }],
      ]) {
        await http()
          .post(`/api/v1/decks/${deck.id}/cards`)
          .set('Authorization', alice.auth)
          .send({ cards })
          .expect(400);
      }
    });

    it('enforces the per-deck card limit atomically', async () => {
      const deck = await createDeck(alice.auth);
      await t.prisma.deck.update({
        where: { id: deck.id },
        data: { cardCount: 4999 },
      });

      const res = await http()
        .post(`/api/v1/decks/${deck.id}/cards`)
        .set('Authorization', alice.auth)
        .send({
          cards: [
            { term: 'a', definition: 'b' },
            { term: 'c', definition: 'd' },
          ],
        })
        .expect(422);
      expect(res.body.code).toBe('DECK_CARD_LIMIT');
      expect(await t.prisma.card.count()).toBe(0);
      expect(
        (await t.prisma.deck.findUnique({ where: { id: deck.id } }))?.cardCount,
      ).toBe(4999);
    });
  });

  describe('POST /decks/:id/cards/import', () => {
    const importInto = (deckId: string, body: Record<string, unknown>) =>
      http()
        .post(`/api/v1/decks/${deckId}/cards/import`)
        .set('Authorization', alice.auth)
        .send(body);

    it('imports a TSV and reports skipped rows', async () => {
      const deck = await createDeck(alice.auth);
      const res = await importInto(deck.id, {
        content: 'cat\tcon mèo\ndog\n\tno term\nbird\tcon chim',
      }).expect(200);

      expect(res.body).toMatchObject({
        delimiter: 'tab',
        importedCount: 2,
        errors: [
          { line: 2, reason: 'Missing definition' },
          { line: 3, reason: 'Missing term' },
        ],
      });
      const deckAfter = await t.prisma.deck.findUnique({
        where: { id: deck.id },
      });
      expect(deckAfter?.cardCount).toBe(2);
    });

    it('previews without saving on dryRun', async () => {
      const deck = await createDeck(alice.auth);
      const res = await importInto(deck.id, {
        content: 'Từ,Nghĩa\ncat,con mèo',
        hasHeader: true,
        dryRun: true,
      }).expect(200);
      expect(res.body).toMatchObject({
        importedCount: 0,
        cards: [{ line: 2, term: 'cat', definition: 'con mèo' }],
      });
      expect(await t.prisma.card.count()).toBe(0);
    });

    it('returns IMPORT_PARSE_ERROR for malformed CSV', async () => {
      const deck = await createDeck(alice.auth);
      const res = await importInto(deck.id, {
        content: 'a,"unclosed\nb,c',
        delimiter: 'comma',
      }).expect(400);
      expect(res.body.code).toBe('IMPORT_PARSE_ERROR');
    });

    it('accepts a large file (well over the default 100kb body limit)', async () => {
      const deck = await createDeck(alice.auth);
      const definition = 'nghĩa tiếng Việt có dấu '.repeat(24); // ~576 chars, multi-byte
      const content = Array.from(
        { length: 1500 },
        (_, i) => `word${i}\t${definition}`,
      ).join('\n');
      expect(Buffer.byteLength(content)).toBeGreaterThan(1_000_000);

      const res = await importInto(deck.id, { content }).expect(200);
      expect(res.body.importedCount).toBe(1500);
    });
  });
});

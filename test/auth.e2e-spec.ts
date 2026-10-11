import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import {
  createTestApp,
  fakeGoogleToken,
  getCookie,
  resetDatabase,
  type TestApp,
} from './helpers.js';

const COOKIE = 'eq_refresh';

describe('Auth & /me (e2e)', () => {
  let t: TestApp;
  const http = () => request(t.app.getHttpServer());

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(async () => {
    await t.app.close();
  });

  beforeEach(async () => {
    await resetDatabase(t.prisma);
  });

  async function login(profile = {}) {
    const res = await http()
      .post('/api/v1/auth/google')
      .send({ idToken: fakeGoogleToken(profile) })
      .expect(200);
    const cookie = getCookie(res.headers['set-cookie'], COOKIE);
    return {
      body: res.body,
      accessToken: res.body.accessToken as string,
      refresh: cookie!.value,
      rawCookie: cookie!.raw,
    };
  }

  const refreshWith = (token: string) =>
    http().post('/api/v1/auth/refresh').set('Cookie', `${COOKIE}=${token}`);

  describe('POST /auth/google', () => {
    it('creates the account on first sign-in and sets the refresh cookie', async () => {
      const { body, rawCookie } = await login();

      expect(body).toMatchObject({
        accessToken: expect.any(String),
        expiresIn: 900,
        isNewUser: true,
        user: {
          email: 'learner@example.com',
          displayName: 'Test Learner',
          avatarUrl: 'https://example.com/avatar.png',
          nativeLang: 'vi',
          role: 'USER',
          plan: 'FREE',
          planExpiresAt: null,
        },
      });
      expect(rawCookie).toMatch(/HttpOnly/i);
      expect(rawCookie).toMatch(/SameSite=Lax/i);
      expect(rawCookie).toMatch(/Path=\//);
      expect(await t.prisma.subscription.count()).toBe(1);
    });

    it('signs an existing user back in without creating a new account', async () => {
      const first = await login();
      const second = await login();

      expect(second.body.isNewUser).toBe(false);
      expect(second.body.user.id).toBe(first.body.user.id);
      expect(await t.prisma.user.count()).toBe(1);
    });

    it('links a new Google identity to an account with the same email', async () => {
      const first = await login({ sub: 'sub-a', email: 'Same@Example.com' });
      const second = await login({ sub: 'sub-b', email: 'same@example.com' });

      expect(second.body.user.id).toBe(first.body.user.id);
      expect(await t.prisma.identity.count()).toBe(2);
    });

    it('rejects an unverified Google email', async () => {
      const res = await http()
        .post('/api/v1/auth/google')
        .send({ idToken: fakeGoogleToken({ emailVerified: false }) })
        .expect(401);
      expect(res.body.code).toBe('AUTH_EMAIL_NOT_VERIFIED');
      expect(await t.prisma.user.count()).toBe(0);
    });

    it('rejects a token Google does not accept', async () => {
      const res = await http()
        .post('/api/v1/auth/google')
        .send({ idToken: 'eyJhbGciOiJub25lIn0.bm90LWpzb24.c2ln' })
        .expect(401);
      expect(res.body.code).toBe('AUTH_INVALID_GOOGLE_TOKEN');
    });

    it('validates the request body', async () => {
      const res = await http()
        .post('/api/v1/auth/google')
        .send({ idToken: 'not-a-jwt' })
        .expect(400);
      expect(res.body.code).toBe('BAD_REQUEST');
    });
  });

  describe('access token guard', () => {
    it('requires a Bearer token', async () => {
      const res = await http().get('/api/v1/me').expect(401);
      expect(res.body.code).toBe('AUTH_MISSING_TOKEN');
    });

    it('rejects a tampered token', async () => {
      const { accessToken } = await login();
      const res = await http()
        .get('/api/v1/me')
        .set('Authorization', `Bearer ${accessToken}x`)
        .expect(401);
      expect(res.body.code).toBe('AUTH_INVALID_TOKEN');
    });

    it('rejects an expired token', async () => {
      const { body } = await login();
      const expired = await t.app
        .get(JwtService)
        .signAsync({ sub: body.user.id, role: 'USER' }, { expiresIn: -10 });
      const res = await http()
        .get('/api/v1/me')
        .set('Authorization', `Bearer ${expired}`)
        .expect(401);
      expect(res.body.code).toBe('AUTH_INVALID_TOKEN');
    });
  });

  describe('/me', () => {
    it('returns the profile of the signed-in user', async () => {
      const { accessToken, body } = await login();
      const res = await http()
        .get('/api/v1/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);
      expect(res.body).toEqual(body.user);
    });

    it('updates profile settings', async () => {
      const { accessToken } = await login();
      const res = await http()
        .patch('/api/v1/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          displayName: 'Đức',
          targetLangs: ['en', 'ja'],
          timezone: 'Europe/Paris',
          dailyNewLimit: 30,
        })
        .expect(200);
      expect(res.body).toMatchObject({
        displayName: 'Đức',
        targetLangs: ['en', 'ja'],
        timezone: 'Europe/Paris',
        dailyNewLimit: 30,
      });
    });

    it.each([
      [{ timezone: 'Mars/Olympus' }],
      [{ dailyNewLimit: 1000 }],
      [{ targetLangs: ['english'] }],
      [{ role: 'ADMIN' }], // not a writable field
    ])('rejects invalid update %j', async (payload) => {
      const { accessToken } = await login();
      await http()
        .patch('/api/v1/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .send(payload)
        .expect(400);
    });

    it('deletes the account and everything that belongs to it', async () => {
      const { accessToken } = await login();
      await http()
        .delete('/api/v1/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(204);

      expect(await t.prisma.user.count()).toBe(0);
      expect(await t.prisma.identity.count()).toBe(0);
      expect(await t.prisma.refreshToken.count()).toBe(0);

      // The access token is still cryptographically valid for a few minutes, but the user is gone.
      const res = await http()
        .get('/api/v1/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(401);
      expect(res.body.code).toBe('AUTH_USER_NOT_FOUND');
    });
  });

  describe('POST /auth/refresh', () => {
    it('issues a new access token and rotates the refresh cookie', async () => {
      const { refresh } = await login();
      const res = await refreshWith(refresh).expect(200);

      expect(res.body).toEqual({
        accessToken: expect.any(String),
        expiresIn: 900,
      });
      const rotated = getCookie(res.headers['set-cookie'], COOKIE)!.value;
      expect(rotated).not.toBe(refresh);

      await http()
        .get('/api/v1/me')
        .set('Authorization', `Bearer ${res.body.accessToken}`)
        .expect(200);
    });

    it('rejects a missing or unknown refresh token', async () => {
      const missing = await http().post('/api/v1/auth/refresh').expect(401);
      expect(missing.body.code).toBe('AUTH_INVALID_REFRESH_TOKEN');
      await refreshWith('unknown-token').expect(401);
    });

    it('rejects an expired refresh token', async () => {
      const { refresh } = await login();
      await t.prisma.refreshToken.updateMany({
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      await refreshWith(refresh).expect(401);
    });

    it('treats a just-rotated token as a race and keeps the session alive', async () => {
      const { refresh } = await login();
      const first = await refreshWith(refresh).expect(200);
      const rotated = getCookie(first.headers['set-cookie'], COOKIE)!.value;

      // Second tab used the old cookie: rejected, but must not clear the shared cookie jar.
      const raced = await refreshWith(refresh).expect(401);
      expect(getCookie(raced.headers['set-cookie'], COOKIE)).toBeUndefined();
      await refreshWith(rotated).expect(200); // the newer cookie still works
    });

    it('revokes every session when an old refresh token is replayed', async () => {
      const { refresh } = await login();
      const first = await refreshWith(refresh).expect(200);
      const rotated = getCookie(first.headers['set-cookie'], COOKIE)!.value;
      const otherDevice = (await login()).refresh;

      // Pretend the old token was rotated long ago, then someone replays it.
      await t.prisma.refreshToken.updateMany({
        where: { revokedAt: { not: null } },
        data: { revokedAt: new Date(Date.now() - 60_000) },
      });
      await refreshWith(refresh).expect(401);

      await refreshWith(rotated).expect(401);
      await refreshWith(otherDevice).expect(401);
    });
  });

  describe('POST /auth/logout', () => {
    it('revokes the refresh token and clears the cookie', async () => {
      const { refresh } = await login();
      const res = await http()
        .post('/api/v1/auth/logout')
        .set('Cookie', `${COOKIE}=${refresh}`)
        .expect(204);

      const cleared = getCookie(res.headers['set-cookie'], COOKIE)!;
      expect(cleared.value).toBe('');
      expect(cleared.raw).toMatch(/Expires=Thu, 01 Jan 1970/);
      await refreshWith(refresh).expect(401);
    });

    it('succeeds even without a cookie', async () => {
      await http().post('/api/v1/auth/logout').expect(204);
    });
  });
});

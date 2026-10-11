import request from 'supertest';
import { createTestApp, type TestApp } from './helpers.js';

describe('App (e2e)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(async () => {
    await t.app.close();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('GET /api/v1/health reports ok when the database answers', () => {
    return request(t.app.getHttpServer())
      .get('/api/v1/health')
      .expect(200)
      .expect({ status: 'ok', database: 'up' });
  });

  it('GET /api/v1/health returns 503 when the database is down', () => {
    vi.spyOn(t.prisma, '$queryRaw').mockRejectedValue(
      new Error('connection refused'),
    );
    return request(t.app.getHttpServer())
      .get('/api/v1/health')
      .expect(503)
      .expect({
        statusCode: 503,
        code: 'DATABASE_UNAVAILABLE',
        message: 'Database is not reachable',
      });
  });

  it('unknown routes use the standard error shape', async () => {
    const res = await request(t.app.getHttpServer())
      .get('/api/v1/nope')
      .expect(404);
    expect(res.body).toMatchObject({ statusCode: 404, code: 'NOT_FOUND' });
  });

  it('serves the OpenAPI spec for the frontend', async () => {
    const res = await request(t.app.getHttpServer())
      .get('/docs-json')
      .expect(200);
    expect(Object.keys(res.body.paths)).toEqual(
      expect.arrayContaining([
        '/api/v1/health',
        '/api/v1/auth/google',
        '/api/v1/auth/refresh',
        '/api/v1/auth/logout',
        '/api/v1/me',
      ]),
    );
  });

  it('allows CORS from the frontend origin with credentials', () => {
    return request(t.app.getHttpServer())
      .get('/api/v1/health')
      .set('Origin', 'http://localhost:3000')
      .expect('Access-Control-Allow-Origin', 'http://localhost:3000')
      .expect('Access-Control-Allow-Credentials', 'true');
  });
});

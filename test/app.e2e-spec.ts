import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from './../src/app.module.js';
import { PrismaService } from './../src/prisma/prisma.service.js';
import { setupApp } from './../src/setup-app.js';

describe('App (e2e)', () => {
  let app: INestApplication<App>;
  const prisma = { $queryRaw: vi.fn(), $disconnect: vi.fn() };

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .compile();

    app = moduleFixture.createNestApplication();
    setupApp(app);
    await app.init();
  });

  afterEach(async () => {
    await app.close();
    vi.resetAllMocks();
  });

  it('GET /api/v1/health reports ok when the database answers', () => {
    prisma.$queryRaw.mockResolvedValue([{ '?column?': 1 }]);
    return request(app.getHttpServer())
      .get('/api/v1/health')
      .expect(200)
      .expect({ status: 'ok', database: 'up' });
  });

  it('GET /api/v1/health returns 503 when the database is down', () => {
    prisma.$queryRaw.mockRejectedValue(new Error('connection refused'));
    return request(app.getHttpServer())
      .get('/api/v1/health')
      .expect(503)
      .expect({
        statusCode: 503,
        code: 'DATABASE_UNAVAILABLE',
        message: 'Database is not reachable',
      });
  });

  it('unknown routes use the standard error shape', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/nope')
      .expect(404);
    expect(res.body).toMatchObject({ statusCode: 404, code: 'NOT_FOUND' });
  });

  it('serves the OpenAPI spec for the frontend', async () => {
    const res = await request(app.getHttpServer())
      .get('/docs-json')
      .expect(200);
    expect(res.body.paths).toHaveProperty('/api/v1/health');
  });

  it('allows CORS from the frontend origin with credentials', () => {
    return request(app.getHttpServer())
      .get('/api/v1/health')
      .set('Origin', 'http://localhost:3000')
      .expect('Access-Control-Allow-Origin', 'http://localhost:3000')
      .expect('Access-Control-Allow-Credentials', 'true');
  });
});

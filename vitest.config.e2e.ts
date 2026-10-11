import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    // ConfigModule validates env when AppModule is imported, so it must be set before any test code runs.
    // e2e tests replace PrismaService with a mock, so this URL is never connected to.
    env: {
      NODE_ENV: 'test',
      LOG_LEVEL: 'fatal',
      DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
      CORS_ORIGINS: 'http://localhost:3000',
    },
  },
});

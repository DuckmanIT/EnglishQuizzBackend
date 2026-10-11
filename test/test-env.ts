// Environment for the e2e suite, shared by vitest.config.e2e.ts (test workers) and global-setup.ts.
// e2e tests use their own database (englishquizz_test), never the dev one.
export const testEnv = {
  NODE_ENV: 'test',
  LOG_LEVEL: 'fatal',
  DATABASE_URL:
    process.env.TEST_DATABASE_URL ??
    'postgresql://postgres:postgres@localhost:5432/englishquizz_test',
  CORS_ORIGINS: 'http://localhost:3000',
  JWT_ACCESS_SECRET: 'test-secret-that-is-at-least-32-characters-long',
  GOOGLE_CLIENT_ID: 'test-client-id.apps.googleusercontent.com',
};

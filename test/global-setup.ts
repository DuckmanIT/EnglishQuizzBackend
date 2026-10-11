import { execSync } from 'node:child_process';
import pg from 'pg';
import { testEnv } from './test-env.js';

// Runs once before the e2e suite: make sure the dedicated test database exists and is migrated.
// It is never the dev database (englishquizz) — see test-env.ts.
export default async function setup(): Promise<void> {
  const url = new URL(testEnv.DATABASE_URL);
  const dbName = url.pathname.slice(1);
  if (!dbName.endsWith('_test')) {
    throw new Error(
      `Refusing to run e2e tests against "${dbName}": the database name must end with "_test".`,
    );
  }

  const adminUrl = new URL(url);
  adminUrl.pathname = '/postgres';
  const admin = new pg.Client({ connectionString: adminUrl.toString() });
  await admin.connect();
  try {
    const { rowCount } = await admin.query(
      'SELECT 1 FROM pg_database WHERE datname = $1',
      [dbName],
    );
    if (!rowCount) await admin.query(`CREATE DATABASE "${dbName}"`);
  } finally {
    await admin.end();
  }

  execSync('npx prisma migrate deploy', {
    stdio: 'inherit',
    env: { ...process.env, DIRECT_URL: url.toString() },
  });
}

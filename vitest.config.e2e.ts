import { defineConfig } from 'vitest/config';
import { testEnv } from './test/test-env.js';

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    globalSetup: ['./test/global-setup.ts'],
    // All files share one database, so run them one at a time.
    fileParallelism: false,
    // ConfigModule validates env when AppModule is imported, so it must be set before any test code runs.
    env: testEnv,
  },
});

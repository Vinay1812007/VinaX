import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // The filesystem, process and git suites do real work in temporary
    // directories; a generous ceiling keeps a slow CI runner from failing
    // a test that is merely waiting for a child process.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    pool: 'forks',
  },
});

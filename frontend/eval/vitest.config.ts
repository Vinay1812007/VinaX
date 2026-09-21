/**
 * The offline evaluation runner — on demand only.
 *
 * `npx vitest run` (the default config) collects `**\/*.{test,spec}.*`, and
 * nothing in this folder is named that way, so the evaluation never rides the
 * unit-test gate: it takes minutes, it writes reports, and it is a
 * measurement, not a pass/fail contract. Run it with
 *
 *   node scripts/eval-recs.mjs                       (both pipelines + reports)
 *   npx vitest run --config eval/vitest.config.ts    (the current pipeline alone)
 *
 * EVAL_SRC points `@` at another checkout of `src` — that is how the frozen
 * baseline (`git archive 7c4e2f5`) is run against the same fixtures, with the
 * harness, the fixtures and the measuring stick unchanged.
 */
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const here = (p: string): string => fileURLToPath(new URL(p, import.meta.url));
const src = process.env.EVAL_SRC ? resolve(process.env.EVAL_SRC) : here('../src');

export default defineConfig({
  root: here('..'),
  define: { __APP_VERSION__: JSON.stringify(process.env.EVAL_APP_VERSION ?? 'evaluation') },
  resolve: { alias: { '@': src } },
  test: {
    include: ['eval/**/*.eval.ts'],
    environment: 'jsdom',
    pool: 'forks',
    testTimeout: 30 * 60_000,
    hookTimeout: 60_000,
    teardownTimeout: 10_000,
    reporters: ['default'],
    passWithNoTests: false,
  },
});

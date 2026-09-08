/**
 * Minimal `@playwright/test`-compatible surface on top of vitest + playwright-core.
 *
 * `@playwright/test` is not a dependency of this package (only the
 * `playwright-core` driver is), so `e2e/vitest.config.ts` aliases the module
 * name to this file. Specs keep the stock shape —
 *
 *   import { test, expect, type Page } from '@playwright/test';
 *   test('…', async ({ page }) => { await page.goto('/'); … });
 *
 * — and only the subset implemented here is available:
 *   • fixtures: `page`, `context`, `browser`, `baseURL` (one Chromium per
 *     spec file, a fresh context per test; `test.use()` merges context
 *     options such as `hasTouch`, `viewport`, `locale`, `reducedMotion`).
 *   • `test.describe`, `test.beforeEach/afterEach`, `test.setTimeout`,
 *     `test.skip(name, fn)`, `test.only`.
 *   • `expect` is vitest's, extended with retrying locator matchers:
 *     toBeVisible, toBeHidden, toBeAttached, toHaveCount, toHaveText,
 *     toContainText, toHaveValue, toHaveClass, toHaveAttribute
 *     (5 s default timeout, `.not` supported). `expect.poll` is vitest's.
 */
import { chromium, type Browser, type BrowserContext, type BrowserContextOptions, type Locator, type Page } from 'playwright-core';
import { afterAll, afterEach, beforeEach, describe, expect as vexpect, inject, test as vtest, vi } from 'vitest';

export type { Browser, BrowserContext, Locator, Page, Request, Route } from 'playwright-core';

declare module 'vitest' {
  interface ProvidedContext {
    baseURL: string;
  }
  interface Assertion<T> {
    toBeVisible(options?: { timeout?: number }): Promise<T>;
    toBeHidden(options?: { timeout?: number }): Promise<T>;
    toBeAttached(options?: { timeout?: number }): Promise<T>;
    toHaveCount(count: number, options?: { timeout?: number }): Promise<T>;
    toHaveText(expected: string | RegExp, options?: { timeout?: number }): Promise<T>;
    toContainText(expected: string | RegExp, options?: { timeout?: number }): Promise<T>;
    toHaveValue(expected: string | RegExp, options?: { timeout?: number }): Promise<T>;
    toHaveClass(expected: string | RegExp, options?: { timeout?: number }): Promise<T>;
    toHaveAttribute(name: string, expected?: string | RegExp, options?: { timeout?: number }): Promise<T>;
  }
}

// ---------------------------------------------------------------- browser --
let browserPromise: Promise<Browser> | null = null;

function launchBrowser(): Promise<Browser> {
  if (!browserPromise) {
    const executablePath = process.env.E2E_CHROMIUM_PATH || process.env.PLAYWRIGHT_EXECUTABLE_PATH;
    browserPromise = chromium.launch({
      args: ['--no-sandbox'],
      ...(executablePath ? { executablePath } : {}),
    });
  }
  return browserPromise;
}

afterAll(async () => {
  if (!browserPromise) return;
  const b = await browserPromise;
  browserPromise = null;
  await b.close();
});

// --------------------------------------------------------------- fixtures --
type UseOptions = BrowserContextOptions & { contextOptions?: BrowserContextOptions };
let useOptions: UseOptions = {};

const DEFAULT_CONTEXT: BrowserContextOptions = {
  viewport: { width: 1280, height: 900 },
  locale: 'en-IN',
  timezoneId: 'Asia/Kolkata',
};

interface Fixtures {
  baseURL: string;
  browser: Browser;
  context: BrowserContext;
  page: Page;
}

const extended = vtest.extend<Fixtures>({
  // eslint-disable-next-line no-empty-pattern
  baseURL: async ({}, use) => {
    await use(inject('baseURL'));
  },
  // eslint-disable-next-line no-empty-pattern
  browser: async ({}, use) => {
    await use(await launchBrowser());
  },
  context: async ({ browser, baseURL }, use) => {
    const { contextOptions, ...rest } = useOptions;
    const ctx = await browser.newContext({ ...DEFAULT_CONTEXT, baseURL, ...contextOptions, ...rest });
    await use(ctx);
    await ctx.close();
  },
  page: async ({ context }, use) => {
    const page = await context.newPage();
    await use(page);
  },
});

type TestFn = (args: Fixtures) => Promise<void> | void;
type TestApi = typeof extended & {
  describe: typeof describe;
  beforeEach: (fn: TestFn) => void;
  afterEach: (fn: TestFn) => void;
  use: (options: UseOptions) => void;
  setTimeout: (ms: number) => void;
  slow: () => void;
};

export const test: TestApi = Object.assign(extended, {
  describe,
  beforeEach: (fn: TestFn) => beforeEach(fn as never),
  afterEach: (fn: TestFn) => afterEach(fn as never),
  use: (options: UseOptions) => {
    useOptions = { ...useOptions, ...options };
  },
  setTimeout: (ms: number) => vi.setConfig({ testTimeout: ms }),
  slow: () => undefined,
});

// --------------------------------------------------------------- matchers --
const DEFAULT_TIMEOUT = 5_000;
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Poll `probe` until it returns the wanted outcome or the timeout passes. */
async function settle(probe: () => Promise<boolean>, wanted: boolean, timeout = DEFAULT_TIMEOUT): Promise<boolean> {
  const end = Date.now() + timeout;
  for (;;) {
    let ok = false;
    try {
      ok = await probe();
    } catch {
      ok = false;
    }
    if (ok === wanted || Date.now() >= end) return ok;
    await sleep(100);
  }
}

const norm = (s: string): string => s.replace(/\s+/g, ' ').trim();
const matches = (actual: string, expected: string | RegExp, exact: boolean): boolean =>
  expected instanceof RegExp ? expected.test(actual) : exact ? norm(actual) === norm(expected) : norm(actual).includes(norm(expected));

function asLocator(received: unknown): Locator {
  if (received && typeof received === 'object' && 'waitFor' in (received as object)) return received as Locator;
  throw new TypeError('This matcher expects a playwright Locator');
}

interface MatcherThis {
  isNot: boolean;
}
type Opts = { timeout?: number } | undefined;
type Result = { pass: boolean; message: () => string };

function locatorMatcher(
  name: string,
  probe: (loc: Locator, ...args: unknown[]) => Promise<boolean>,
  describeExpected: (...args: unknown[]) => string,
) {
  return async function (this: MatcherThis, received: unknown, ...args: unknown[]): Promise<Result> {
    const loc = asLocator(received);
    const last = args[args.length - 1];
    const opts: Opts = last && typeof last === 'object' && !(last instanceof RegExp) ? (last as Opts) : undefined;
    const pass = await settle(() => probe(loc, ...args), !this.isNot, opts?.timeout);
    return {
      pass,
      message: () => `expected ${String(loc)} ${this.isNot ? 'not ' : ''}${name} ${describeExpected(...args)}`.trim(),
    };
  };
}

vexpect.extend({
  toBeVisible: locatorMatcher('to be visible', (l) => l.isVisible(), () => ''),
  toBeHidden: locatorMatcher('to be hidden', async (l) => !(await l.isVisible()), () => ''),
  toBeAttached: locatorMatcher('to be attached', async (l) => (await l.count()) > 0, () => ''),
  toHaveCount: locatorMatcher(
    'to have count',
    async (l, n) => (await l.count()) === n,
    (n) => String(n),
  ),
  toHaveText: locatorMatcher(
    'to have text',
    async (l, exp) => matches(await l.innerText(), exp as string | RegExp, true),
    (exp) => String(exp),
  ),
  toContainText: locatorMatcher(
    'to contain text',
    async (l, exp) => matches(await l.innerText(), exp as string | RegExp, false),
    (exp) => String(exp),
  ),
  toHaveValue: locatorMatcher(
    'to have value',
    async (l, exp) => matches(await l.inputValue(), exp as string | RegExp, true),
    (exp) => String(exp),
  ),
  toHaveClass: locatorMatcher(
    'to have class',
    async (l, exp) => matches((await l.getAttribute('class')) ?? '', exp as string | RegExp, false),
    (exp) => String(exp),
  ),
  toHaveAttribute: locatorMatcher(
    'to have attribute',
    async (l, name, exp) => {
      const v = await l.getAttribute(name as string);
      if (v === null) return false;
      if (exp === undefined || (typeof exp === 'object' && !(exp instanceof RegExp))) return true;
      return matches(v, exp as string | RegExp, true);
    },
    (name, exp) => `${String(name)}${exp !== undefined ? `=${String(exp)}` : ''}`,
  ),
});

export const expect = vexpect;

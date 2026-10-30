/**
 * Accessibility gate: axe-core (@axe-core/playwright) scans the app's main
 * pages in the dark and the light theme, on desktop and on a phone, plus the
 * sign-in screen, the festival greeting and the erase-everything dialog.
 *
 * Any WCAG 2.0 / 2.1 / 2.2 level A or AA violation fails the test, whatever
 * axe's impact rating. The full axe result for each scan is attached to the
 * HTML report (npm run e2e:report → the test → Attachments).
 *
 * What axe cannot do: it marks colour contrast "incomplete" (not passed, not
 * failed) on text over glass, gradients and images, and it checks nothing
 * about focus order or what a screen reader actually says. Those still need a
 * person. This gate keeps the mechanical regressions out.
 *
 * Deterministic: everything off localhost is aborted, /api answers `{}`, the
 * festival calendar is switched off (one forced-festival scan covers the
 * greeting) and motion is reduced so no scan lands mid-animation, when text
 * is still at partial opacity.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page, type Locator } from './support/test';
import { latestNotesFingerprint } from '../src/constants/changelog';

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

test.use({ contextOptions: { reducedMotion: 'reduce' } });

type Theme = 'dark' | 'light';

async function seed(page: Page, theme: Theme, festival: { mode: 'off' } | { mode: 'force'; id: string } = { mode: 'off' }) {
  await page.addInitScript(
    ([t, fp]) => {
      localStorage.setItem(
        'vinax.settings.v1',
        JSON.stringify({ state: { theme: t, accent: 'crimson', pinnedLanguages: ['telugu'] }, version: 2 }),
      );
      localStorage.setItem('vinax.onboarded.v1', 'true');
      localStorage.setItem('vinax.user-name', JSON.stringify('Tester'));
      localStorage.setItem('vinax.user-handle', JSON.stringify('tester'));
      localStorage.setItem('vinax.analytics-consent', 'false');
      localStorage.setItem('vinax.last-seen-version', JSON.stringify(fp));
    },
    [theme, latestNotesFingerprint()] as const,
  );
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (!url.origin.startsWith('http://localhost')) return route.abort();
    if (url.pathname === '/api/appconfig' && url.searchParams.get('key') === 'festival') {
      return route.fulfill({ json: { festival } });
    }
    if (url.pathname.startsWith('/api/')) return route.fulfill({ json: {} });
    return route.continue();
  });
}

/** Runs axe, attaches the full result to the report, and returns one line per violation. */
async function scan(page: Page, name: string): Promise<string[]> {
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  await test.info().attach(`axe ${name}`, { body: JSON.stringify(results, null, 2), contentType: 'application/json' });
  return results.violations.map(
    (v) => `${v.id} (${v.impact}): ${v.help}. ${v.nodes.length} element(s): ${v.nodes
      .slice(0, 5)
      .map((n) => n.target.join(' '))
      .join(', ')}`,
  );
}

async function settle(page: Page, ready: Locator): Promise<void> {
  await expect(ready).toBeVisible({ timeout: 15_000 });
  await page.waitForLoadState('networkidle');
}

/** Each page and the heading that proves its content (not a loading shell) is up. */
const PAGES: { path: string; ready: (p: Page) => Locator }[] = [
  { path: '/', ready: (p) => p.getByRole('heading', { level: 1 }).first() },
  { path: '/discover', ready: (p) => p.getByRole('heading', { name: 'Discover', level: 1 }) },
  { path: '/search', ready: (p) => p.getByRole('heading', { name: 'Search', level: 1 }) },
  { path: '/library', ready: (p) => p.getByRole('heading', { name: 'Your library', level: 1 }) },
  { path: '/history', ready: (p) => p.getByRole('heading', { name: 'Recently played', level: 1 }) },
  // A fresh profile has nothing queued; the empty page keeps an h1 (sr-only).
  { path: '/queue', ready: (p) => p.getByRole('heading', { name: 'Queue', level: 1 }) },
  { path: '/settings', ready: (p) => p.getByRole('heading', { name: 'Settings', level: 1 }) },
  { path: '/radio', ready: (p) => p.getByRole('heading', { name: 'Radio', level: 1 }) },
  { path: '/stats', ready: (p) => p.getByRole('heading', { name: 'Your VinaX', level: 1 }) },
  { path: '/taste-profile', ready: (p) => p.getByRole('heading', { name: 'Your taste profile', level: 1 }) },
  { path: '/charts', ready: (p) => p.getByRole('heading', { name: 'Charts', level: 1 }) },
  { path: '/moods', ready: (p) => p.getByRole('heading', { name: 'Moods', level: 1 }) },
  { path: '/about', ready: (p) => p.getByRole('heading', { name: 'VinaX', level: 1 }) },
  { path: '/help', ready: (p) => p.getByRole('heading', { name: 'Help & feedback', level: 1 }) },
  { path: '/privacy', ready: (p) => p.getByRole('heading', { name: 'Privacy', level: 1 }) },
];

for (const theme of ['dark', 'light'] as const) {
  test.describe(`${theme} theme, desktop`, () => {
    for (const { path, ready } of PAGES) {
      test(`${path} has no WCAG A/AA violations`, async ({ page }) => {
        await seed(page, theme);
        await page.goto(path);
        await settle(page, ready(page));
        expect(await scan(page, `${path} ${theme}`)).toEqual([]);
      });
    }
  });
}

test.describe('phone (390×844), dark theme', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  for (const { path, ready } of PAGES.filter((p) => ['/', '/search', '/library', '/settings', '/radio'].includes(p.path))) {
    test(`${path} has no WCAG A/AA violations`, async ({ page }) => {
      await seed(page, 'dark');
      await page.goto(path);
      await settle(page, ready(page));
      expect(await scan(page, `${path} phone`)).toEqual([]);
    });
  }
});

test('the sign-in screen has no WCAG A/AA violations', async ({ page }) => {
  await seed(page, 'dark');
  await page.goto('/?e2e-signed-out');
  await settle(page, page.getByRole('heading', { name: 'Welcome to VinaX', level: 1 }));
  expect(await scan(page, 'sign-in')).toEqual([]);
});

test.describe('the festival greeting', () => {
  test.use({ dismissFestivalGreeting: false });
  test('has no WCAG A/AA violations', async ({ page }) => {
    await seed(page, 'dark', { mode: 'force', id: 'diwali' });
    await page.goto('/');
    await settle(page, page.locator('.fest-card[role="dialog"]'));
    expect(await scan(page, 'festival greeting')).toEqual([]);
  });
});

test('the erase-everything dialog is a real modal with no WCAG A/AA violations', async ({ page }) => {
  await seed(page, 'dark');
  await page.goto('/settings');
  await settle(page, page.getByRole('heading', { name: 'Settings', level: 1 }));
  // Keyboard activation: the row can sit under the fixed player dock, and
  // keyboard behaviour is what this test is about.
  await page.getByRole('button', { name: 'Reset', exact: true }).focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Erase everything' });
  await expect(dialog).toBeVisible();
  // Focus moves into the dialog…
  await expect.poll(() => dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true);
  expect(await scan(page, 'erase dialog')).toEqual([]);
  // …and Escape closes it.
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});

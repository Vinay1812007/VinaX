/**
 * /design — the design system v2 style guide (pages/DesignPage.tsx).
 *
 * It is the approval gate of the UI rebuild, so it must render every
 * primitive, pass axe in both themes, stay out of search, preview a festival
 * takeover across the whole app, and give the listener's own look back the
 * moment they leave.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from './support/test';
import { latestNotesFingerprint } from '../src/constants/changelog';

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

test.use({ contextOptions: { reducedMotion: 'reduce' } });

async function seed(page: Page, theme: 'dark' | 'light' = 'dark') {
  await page.addInitScript(
    ([t, fp]) => {
      localStorage.setItem('vinax.settings.v1', JSON.stringify({ state: { theme: t, accent: 'crimson', pinnedLanguages: ['telugu'] }, version: 2 }));
      localStorage.setItem('vinax.onboarded.v1', 'true');
      localStorage.setItem('vinax.user-name', JSON.stringify('Tester'));
      localStorage.setItem('vinax.analytics-consent', 'false');
      localStorage.setItem('vinax.last-seen-version', JSON.stringify(fp));
    },
    [theme, latestNotesFingerprint()] as const,
  );
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (!url.origin.startsWith('http://localhost')) return route.abort();
    // The real calendar would put today's festival skin on; the guide starts from none.
    if (url.pathname === '/api/appconfig' && url.searchParams.get('key') === 'festival') return route.fulfill({ json: { festival: { mode: 'off' } } });
    if (url.pathname.startsWith('/api/')) return route.fulfill({ json: {} });
    return route.continue();
  });
}

async function open(page: Page) {
  await page.goto('/design');
  await expect(page.getByRole('heading', { level: 1, name: 'Every screen, one language.' })).toBeVisible({ timeout: 15_000 });
}

test('renders every section, stays out of search', async ({ page }) => {
  await seed(page);
  await open(page);
  for (const name of ['Colour', 'Type', 'Space, shape and depth', 'Motion', 'Components', 'Player', 'Festival takeover']) {
    await expect(page.getByRole('heading', { level: 2, name })).toBeVisible();
  }
  await expect(page.locator('meta[name="robots"][content*="noindex"]')).toHaveCount(1);
  // The contrast readout measures real tokens: the title ink clears AAA on the canvas.
  await expect(page.locator('.vx-ds-ink').first().locator('.vx-ds-ratio')).toContainText('AAA');
});

for (const theme of ['dark', 'light'] as const) {
  test(`no WCAG A/AA violations, ${theme}`, async ({ page }) => {
    await seed(page, theme);
    await open(page);
    await page.waitForLoadState('networkidle');
    const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
    const lines = results.violations.map((v) => `${v.id}: ${v.nodes.slice(0, 5).map((n) => n.target.join(' ')).join(', ')}`);
    expect(lines).toEqual([]);
  });
}

test('previews a theme and a festival takeover, then gives the listener their own look back', async ({ page }) => {
  await seed(page);
  await open(page);
  const html = page.locator('html');
  const bar = page.getByRole('group', { name: 'Preview' });

  await bar.getByRole('tablist', { name: 'Theme' }).getByRole('tab', { name: 'Light' }).click();
  await expect(html).toHaveClass(/\blight\b/);

  await bar.getByRole('tablist', { name: 'Festival' }).getByRole('tab', { name: 'Diwali' }).click();
  await expect(html).toHaveClass(/\bfest-diwali\b/);
  await expect(html).toHaveClass(/\bvx-takeover\b/);
  // The takeover re-pitches the palette itself, so every page follows.
  const ember = () => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--ember-500').trim());
  expect(await ember()).toBe('150 72 0');
  await bar.getByRole('tablist', { name: 'Theme' }).getByRole('tab', { name: 'Dark' }).click();
  expect(await ember()).toBe('252 196 52');

  // Leaving puts back the saved look: dark, no takeover, no previewed festival.
  await page.getByRole('link', { name: 'Home' }).first().click();
  await expect(page).toHaveURL(/\/$/);
  await expect(html).not.toHaveClass(/\bvx-takeover\b/);
  await expect(html).not.toHaveClass(/\bfest-diwali\b/);
  await expect(html).not.toHaveClass(/\blight\b/);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('vinax.settings.v1') ?? '{}').state?.theme);
  expect(saved).toBe('dark');
});

test('primitives: tabs by keyboard, a switch, and a dialog that returns focus', async ({ page }) => {
  await seed(page);
  await open(page);
  const lib = page.getByRole('tablist', { name: 'Library' });
  await lib.getByRole('tab', { name: /Songs/ }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(lib.getByRole('tab', { name: /Albums/ })).toHaveAttribute('aria-selected', 'true');
  await expect(lib.getByRole('tab', { name: /Albums/ })).toBeFocused();

  const sw = page.getByRole('switch', { name: 'Gapless playback' });
  await expect(sw).toHaveAttribute('aria-checked', 'false');
  await sw.click();
  await expect(sw).toHaveAttribute('aria-checked', 'true');

  const opener = page.getByRole('button', { name: 'Open dialog' });
  await opener.click();
  const dialog = page.getByRole('dialog', { name: 'Clear listening history?' });
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();
});

test('the mini player opens into Now Playing and back', async ({ page }) => {
  await seed(page);
  await open(page);
  await page.getByRole('button', { name: 'Open Now Playing' }).click();
  const full = page.getByRole('region', { name: 'Now Playing' });
  await expect(full).toBeVisible();
  await expect(full.getByRole('slider', { name: 'Position' })).toBeVisible();
  await full.getByRole('button', { name: 'Close Now Playing' }).click();
  await expect(page.getByRole('button', { name: 'Open Now Playing' })).toBeVisible();
});

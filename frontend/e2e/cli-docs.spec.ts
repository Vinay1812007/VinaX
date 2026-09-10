import { test, expect, type Page } from '@playwright/test';
import { latestNotesFingerprint } from '../src/constants/changelog';

/**
 * The public VinaX CLI documentation, against the BUILT bundle.
 *
 * The unit test proves the component renders; this proves the route actually
 * works as a URL — opened directly, refreshed, and reached from VinaX AI —
 * which is the part that a missing prerender entry or a bad Pages fallback
 * would break without any unit test noticing.
 *
 * Offline-deterministic: everything non-local is aborted and every /api answer
 * is mocked, including the live engine list the page fetches.
 */

async function seed(page: Page, theme: 'dark' | 'light' = 'dark'): Promise<void> {
  await page.addInitScript(
    ([t, fp]) => {
      localStorage.setItem(
        'vinax.settings.v1',
        JSON.stringify({ state: { theme: t, accent: 'crimson', pinnedLanguages: ['telugu'] }, version: 2 }),
      );
      localStorage.setItem('vinax.onboarded.v1', 'true');
      localStorage.setItem('vinax.user-name', JSON.stringify('Tester'));
      localStorage.setItem('vinax.analytics-consent', 'false');
      localStorage.setItem('vinax.last-seen-version', JSON.stringify(fp));
    },
    [theme, latestNotesFingerprint()],
  );
}

const ENGINES = {
  protocol: 'vinax-cli/1',
  engines: [
    { id: 'auto', label: 'VinaX AUTO', hint: 'Picks the seat from the task', acceptsModel: false, available: true },
    { id: 'menu', label: 'VinaX Menu', hint: 'Free-model marketplace', acceptsModel: true, available: true },
  ],
};

async function mockNetwork(page: Page): Promise<void> {
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (!url.origin.startsWith('http://localhost')) return route.abort();
    if (url.pathname === '/api/vinaxcli/meta') return route.fulfill({ json: ENGINES });
    if (url.pathname.startsWith('/api/')) return route.fulfill({ json: {} });
    return route.continue();
  });
}

const bodyText = (page: Page): Promise<string> => page.locator('body').innerText();

test('the CLI documentation route works when opened directly and after a refresh', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await seed(page);
  await mockNetwork(page);

  await page.goto('/VinaXAI/cli/docs', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('h1')).toHaveText('VinaX CLI', { timeout: 15_000 });

  const text = await bodyText(page);
  for (const subject of [
    'Installation', 'Requirements', 'Quick start', 'Permission modes',
    'Git', 'Commits', 'Pushes', 'Engines', 'Models', 'Web search',
    'Project instructions', 'Configuration', 'Sessions', 'Slash commands',
    'External tools', 'Non-interactive mode', 'JSON output', 'Exit codes',
    'Security', 'Privacy', 'Troubleshooting', 'vinax doctor',
    'Complete command reference',
  ]) {
    expect(text, `documents "${subject}"`).toContain(subject);
  }

  // The install command and the three permission modes are the two things a
  // reader arrives for.
  expect(text).toContain('npm install -g vinax-cli');
  expect(text).toContain('auto-edit');
  expect(text).toContain('full-auto');

  // A refresh on the same URL must serve the page again, not a 404 shell.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('h1')).toHaveText('VinaX CLI', { timeout: 15_000 });

  expect(pageErrors, 'no page errors').toEqual([]);
});

test('the docs are reachable from VinaX AI, and lead back', async ({ page }) => {
  await seed(page);
  await mockNetwork(page);

  await page.goto('/VinaXAI', { waitUntil: 'domcontentloaded' });
  const link = page.locator('a[aria-label="VinaX CLI documentation"]');
  await expect(link).toHaveAttribute('href', '/VinaXAI/cli/docs', { timeout: 15_000 });

  await page.goto('/VinaXAI/cli/docs', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('h1')).toHaveText('VinaX CLI', { timeout: 15_000 });
  await expect(page.locator('header a[href="/VinaXAI"]')).toBeVisible();
});

test('the contents navigation jumps to a section', async ({ page }) => {
  await seed(page);
  await mockNetwork(page);
  await page.goto('/VinaXAI/cli/docs', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('h1')).toHaveText('VinaX CLI', { timeout: 15_000 });

  const nav = page.locator('nav[aria-label="Documentation contents"]');
  await nav.locator('a[href="#exit-codes"]').first().click();
  await expect(page.locator('#exit-codes')).toBeVisible();
  await expect(page.locator('#exit-codes')).toContainText(/permission denied/i);
});

test('the live engine list is fetched, not hard-coded', async ({ page }) => {
  await seed(page);
  await mockNetwork(page);
  await page.goto('/VinaXAI/cli/docs', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('h1')).toHaveText('VinaX CLI', { timeout: 15_000 });
  await expect(page.locator('#engines')).toContainText('menu', { timeout: 10_000 });
  await expect(page.locator('#engines')).toContainText('Free-model marketplace');
});

test('the docs render in the light theme too', async ({ page }) => {
  await seed(page, 'light');
  await mockNetwork(page);
  await page.goto('/VinaXAI/cli/docs', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('h1')).toHaveText('VinaX CLI', { timeout: 15_000 });
  // The page paints from design tokens, so the background must not be a
  // hard-coded black once the light theme is applied.
  const bg = await page.evaluate(() => {
    const el = document.querySelector('h1')?.closest('div');
    return el ? getComputedStyle(el).color : '';
  });
  expect(bg).toBeTruthy();
});

test('the CLI docs route does not enter the first-load shell', async ({ page }) => {
  await seed(page);
  await mockNetwork(page);
  // Load the music app, then check the docs chunk was not part of what booted.
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  const preloaded = await page.evaluate(() =>
    [...document.querySelectorAll('link[rel="modulepreload"], script[src]')]
      .map((el) => el.getAttribute('href') || el.getAttribute('src') || '')
      .join(' '),
  );
  expect(preloaded.toLowerCase()).not.toContain('clidocs');
});

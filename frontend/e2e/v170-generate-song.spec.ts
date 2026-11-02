import { test, expect, type Page } from './support/test';
import AxeBuilder from '@axe-core/playwright';
import { latestNotesFingerprint } from '../src/constants/changelog';

/**
 * 1.4 — "Generate a song like this", from the built bundle with the Worker's
 * generation routes mocked: Now Playing offers it while a song plays, shows
 * progress while the job runs, and the finished song plays labelled "AI
 * generated". What the page sends is the playing song's feel only. Without a
 * generator the action is not there at all.
 */
interface Song {
  kind: 'song'; id: string; title: string; subtitle: string; artists: { id: string; name: string }[];
  album: { id: string; name: string }; images: { quality: string; url: string }[]; audio: { quality: string; url: string }[];
  duration: number; language: string; year: string; explicit: boolean; hasLyrics: boolean; playCount: number;
}
const JOB = '11111111-1111-4111-8111-111111111111';

async function seed(page: Page, baseURL: string, opts: { available: boolean }): Promise<{ posted: () => Record<string, unknown> | null }> {
  const song: Song = {
    kind: 'song', id: 'src1', title: 'Source Song Title', subtitle: 'Source Singer', artists: [{ id: 'a1', name: 'Source Singer' }], album: { id: 'al1', name: 'Album' },
    images: [{ quality: '500x500', url: `${baseURL}/icons/icon.svg` }], audio: [{ quality: '160kbps', url: `${baseURL}/x.mp4` }],
    duration: 210, language: 'telugu', year: '2021', explicit: false, hasLyrics: false, playCount: 10,
  };
  await page.addInitScript(({ song, fp }) => {
    if (!localStorage.getItem('vinax.player.v1')) localStorage.setItem('vinax.player.v1', JSON.stringify({ state: { queue: [song], index: 0, repeat: 'off', shuffle: false, volume: 1, muted: false, rate: 1 }, version: 1 }));
    localStorage.setItem('vinax.settings.v1', JSON.stringify({ state: { theme: 'dark', pinnedLanguages: ['telugu'], festivalSkins: false }, version: 5 }));
    localStorage.setItem('vinax.onboarded.v1', 'true');
    localStorage.setItem('vinax.user-name', JSON.stringify('Tester'));
    localStorage.setItem('vinax.user-handle', JSON.stringify('tester'));
    localStorage.setItem('vinax.analytics-consent', 'false');
    localStorage.setItem('vinax.last-seen-version', JSON.stringify(fp));
  }, { song, fp: latestNotesFingerprint() });
  let posted: Record<string, unknown> | null = null;
  let polls = 0;
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (!url.origin.startsWith('http://localhost')) return route.abort();
    if (url.pathname === '/api/appconfig') return route.fulfill({ json: { mode: 'off' } });
    if (url.pathname === '/api/ai/generate-song') {
      if (route.request().method() === 'POST') {
        posted = JSON.parse(route.request().postData() ?? '{}') as Record<string, unknown>;
        return route.fulfill({ status: 202, json: { jobId: JOB, status: 'queued', progress: 0, remaining: 4 } });
      }
      return route.fulfill({ json: opts.available ? { available: true, limit: 5, remaining: 5, ttlHours: 24 } : { available: false, reason: 'gen_not_configured', limit: 5, remaining: 0 } });
    }
    if (url.pathname === `/api/ai/generate-song/${JOB}`) {
      polls += 1;
      return route.fulfill({ json: polls < 2 ? { status: 'running', progress: 0.45, durationSec: 120, instrumental: false } : { status: 'done', progress: 1, title: 'Monsoon Lanterns', durationSec: 120, instrumental: false, audioUrl: `/api/ai/generate-song/${JOB}/audio`, expiresAt: Date.now() + 86_400_000 } });
    }
    if (url.pathname.startsWith('/api/')) return route.fulfill({ json: {} });
    return route.continue();
  });
  return { posted: () => posted };
}

test('Generate a song like this: progress, then a new song labelled "AI generated"', async ({ page, baseURL }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const seen = await seed(page, baseURL!, { available: true });
  await page.goto('/now-playing');
  await page.getByRole('button', { name: '✦ Generate a song like this' }).click();
  await page.getByRole('button', { name: '2 min' }).click();
  await page.getByRole('button', { name: 'Generate', exact: true }).click();
  await expect(page.getByRole('progressbar', { name: 'Making your song' })).toBeVisible();
  await expect(page.locator('.vx-np-gen-done')).toContainText('Monsoon Lanterns', { timeout: 15_000 });
  await expect(page.locator('.vx-np-gen-done .vx-ai-badge')).toHaveText('AI generated');

  // Only the feel left the page: no title, no artist, no audio.
  const body = JSON.stringify(seen.posted());
  expect(body).not.toContain('Source Song Title');
  expect(body).not.toContain('Source Singer');
  expect(body).not.toContain('x.mp4');
  expect(seen.posted()).toMatchObject({ language: 'telugu', durationSec: 120, instrumental: false });

  const scan = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).include('.vx-np-gen').analyze();
  expect(scan.violations.map((v) => v.id)).toEqual([]);

  await page.getByRole('button', { name: 'Play now' }).click();
  await expect(page.locator('.vx-np-title')).toContainText('Monsoon Lanterns');
  await expect(page.locator('.vx-np-artist')).toHaveText('AI generated · VinaX AI');
  await expect(page.locator('.vx-np-ai-badge')).toHaveText('AI generated');
});

test('without a generator, Now Playing does not offer it', async ({ page, baseURL }) => {
  await seed(page, baseURL!, { available: false });
  await page.goto('/now-playing');
  await expect(page.locator('.vx-np-title')).toContainText('Source Song Title');
  await page.waitForTimeout(1_000);
  await expect(page.getByRole('button', { name: '✦ Generate a song like this' })).toHaveCount(0);
});

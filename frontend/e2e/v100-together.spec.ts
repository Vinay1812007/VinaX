import { test, expect, type Browser, type Page } from '@playwright/test';
import { latestNotesFingerprint } from '../src/constants/changelog';

/**
 * 10.0 — Listen Together, two real browser tabs (a host and a guest) talking
 * through an in-memory stand-in for /api/room that keeps the server's
 * contract (server clock in every poll, guest requests as id/title stubs).
 *
 * What broke before 10.0, and what this pins:
 *   - the session lived in the page: a host who opened another page stopped
 *     broadcasting, and the guest stopped following;
 *   - guests drifted and kept seeking (they anchored on when THEY saw a push);
 *   - a guest's song request reached the host as an unplayable stub.
 */
const SECONDS = 240;
/** Four minutes of silent 8 kHz mono WAV: real, seekable audio. */
function silentWav(): Buffer {
  const samples = 8000 * SECONDS;
  const b = Buffer.alloc(44 + samples);
  b.write('RIFF', 0); b.writeUInt32LE(36 + samples, 4); b.write('WAVE', 8); b.write('fmt ', 12);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(8000, 24);
  b.writeUInt32LE(8000, 28); b.writeUInt16LE(1, 32); b.writeUInt16LE(8, 34); b.write('data', 36);
  b.writeUInt32LE(samples, 40); b.fill(128, 44);
  return b;
}
const WAV = silentWav();

const appSong = (base: string, id: string, title: string) => ({
  kind: 'song', id, title, subtitle: 'Test Artist', artists: [{ id: 'ar1', name: 'Test Artist' }], album: { id: 'al1', name: 'Album' },
  images: [{ quality: '500x500', url: `${base}/icons/icon.svg` }], audio: [{ quality: '160kbps', url: `${base}/t-${id}.wav` }],
  duration: SECONDS, language: 'telugu', year: '2024', explicit: false, hasLyrics: false, playCount: 1,
});
/** The catalogue API's own shape (what getSong / search parse). */
const apiSong = (base: string, id: string, name: string) => ({
  id, name, type: 'song', year: '2024', language: 'telugu', playCount: 1, duration: SECONDS, explicitContent: false, hasLyrics: false,
  album: { id: 'al1', name: 'Album', url: '' },
  artists: { primary: [{ id: 'ar1', name: 'Test Artist', role: 'singer', image: [], type: 'artist', url: '' }] },
  image: [{ quality: '500x500', url: `${base}/icons/icon.svg` }],
  downloadUrl: [{ quality: '160kbps', url: `${base}/t-${id}.wav` }],
});

interface Room { host_name: string; song: unknown; position: number; playing: boolean; updated_at: string; queue: unknown[]; requests: Array<{ song: { id: string }; by: string }> }
function roomServer() {
  const rooms = new Map<string, Room>();
  const members = new Map<string, Map<string, number>>();
  return {
    rooms,
    handle(method: string, url: URL, body: Record<string, unknown> | null): unknown {
      if (method === 'GET') {
        const code = url.searchParams.get('code') ?? '';
        const r = rooms.get(code) ?? null;
        const live = [...(members.get(code)?.values() ?? [])].filter((t) => Date.now() - t < 12_000).length;
        return { room: r, memberCount: live, reactions: [], now: Date.now() };
      }
      const code = String(body?.code ?? '');
      switch (body?.action) {
        case 'create': {
          rooms.set('ABC123', { host_name: String(body.hostName ?? ''), song: body.song ?? null, position: 0, playing: false, updated_at: new Date().toISOString(), queue: [], requests: [] });
          return { code: 'ABC123', hostToken: 'tok' };
        }
        case 'update': {
          const r = rooms.get(code);
          if (!r) return { __status: 404 };
          const consumed = (body.consumedIds as string[]) ?? [];
          Object.assign(r, { song: body.song, position: body.position, playing: body.playing, queue: body.queue, updated_at: new Date().toISOString() });
          r.requests = r.requests.filter((t) => !consumed.includes(t.song.id));
          return { ok: true };
        }
        case 'request': {
          const r = rooms.get(code);
          if (!r) return { __status: 404 };
          const s = body.song as { id: string; title: string };
          r.requests.push({ song: { id: s.id, title: s.title } as { id: string }, by: String(body.by ?? '') });
          return { ok: true };
        }
        case 'heartbeat': {
          if (!members.has(code)) members.set(code, new Map());
          members.get(code)!.set(String(body.deviceId), Date.now());
          return { ok: true };
        }
        case 'end':
          rooms.delete(code);
          return { ok: true };
        default:
          return { ok: true };
      }
    },
  };
}

async function open(browser: Browser, base: string, server: ReturnType<typeof roomServer>, who: string, queue: unknown[]): Promise<Page> {
  const ctx = await browser.newContext({ baseURL: base, viewport: { width: 1280, height: 860 } });
  const page = await ctx.newPage();
  await page.addInitScript(
    ({ who, queue, fp }) => {
      localStorage.setItem('vinax.onboarded.v1', 'true');
      localStorage.setItem('vinax.user-name', JSON.stringify(who));
      localStorage.setItem('vinax.user-handle', JSON.stringify(who.toLowerCase()));
      localStorage.setItem('vinax.analytics-consent', 'false');
      localStorage.setItem('vinax.last-seen-version', JSON.stringify(fp));
      localStorage.setItem('vinax.settings.v1', JSON.stringify({ state: { theme: 'dark', festivalSkins: false, autoplay: false }, version: 3 }));
      if (queue.length) localStorage.setItem('vinax.player.v1', JSON.stringify({ state: { queue, index: 0 }, version: 1 }));
      // Keep a handle on the engine's <audio> (it is never in the DOM).
      const w = window as unknown as { __audio?: HTMLMediaElement };
      const orig = HTMLMediaElement.prototype.play;
      HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
        w.__audio = this;
        return orig.call(this);
      };
    },
    { who, queue, fp: latestNotesFingerprint() },
  );
  await page.route('**/*', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (!url.origin.startsWith('http://localhost')) return route.abort();
    if (/^\/t-.*\.wav$/.test(url.pathname)) {
      // Byte ranges, like a real CDN: without them the browser cannot seek,
      // and a follower could never correct its position.
      const m = /bytes=(\d+)-(\d*)/.exec(req.headers()['range'] ?? '');
      if (!m) return route.fulfill({ body: WAV, contentType: 'audio/wav', headers: { 'accept-ranges': 'bytes' } });
      const start = Number(m[1]);
      const end = m[2] ? Math.min(Number(m[2]), WAV.length - 1) : WAV.length - 1;
      return route.fulfill({
        status: 206,
        body: WAV.subarray(start, end + 1),
        contentType: 'audio/wav',
        headers: { 'accept-ranges': 'bytes', 'content-range': `bytes ${start}-${end}/${WAV.length}` },
      });
    }
    if (url.pathname === '/api/room') {
      const body = req.method() === 'POST' ? (JSON.parse(req.postData() ?? 'null') as Record<string, unknown>) : null;
      const out = server.handle(req.method(), url, body) as { __status?: number };
      return route.fulfill({ status: out.__status ?? 200, json: out });
    }
    if (url.pathname.startsWith('/api/cat/songs')) {
      const id = url.pathname.split('/').pop() || url.searchParams.get('id') || 'x';
      return route.fulfill({ json: { data: [apiSong(base, id, `Song ${id}`)] } });
    }
    if (url.pathname.startsWith('/api/cat/')) {
      return route.fulfill({ json: { data: { results: [apiSong(base, 'g1', 'Guest Pick'), apiSong(base, 'g2', 'Another Pick')] } } });
    }
    if (url.pathname.startsWith('/api/')) return route.fulfill({ json: {} });
    return route.continue();
  });
  return page;
}

const audioState = (p: Page) =>
  p.evaluate(() => {
    const a = (window as unknown as { __audio?: HTMLMediaElement }).__audio;
    return a ? { src: a.currentSrc || a.src, t: a.currentTime, paused: a.paused } : null;
  });

async function startListeningIfAsked(p: Page): Promise<void> {
  const tap = p.getByRole('button', { name: 'Tap to start listening' }).first();
  if (await tap.isVisible().catch(() => false)) await tap.click();
}

test('a guest follows the host across pages, in sync, and its request is playable', async ({ browser, baseURL }) => {
  const base = baseURL!;
  const server = roomServer();
  const host = await open(browser, base, server, 'Asha', [appSong(base, 'a', 'Song A'), appSong(base, 'b', 'Song B')]);
  const guest = await open(browser, base, server, 'Ravi', []);

  // Host: start a session and play.
  await host.goto('/together');
  await host.getByRole('button', { name: 'Start a session' }).click();
  await expect(host.locator('.vx-lt-code')).toHaveText('ABC123');
  await host.getByRole('button', { name: /^Play$/ }).first().click();
  await expect.poll(async () => (await audioState(host))?.paused, { timeout: 10_000 }).toBe(false);

  // The host leaves the Listen Together page; the session must keep going.
  await host.getByRole('link', { name: /^Search$/ }).first().click();
  await expect(host.locator('.vx-lt-pill')).toContainText('Hosting');

  // Guest: the invite link joins by itself.
  await guest.goto('/together?code=ABC123');
  await expect(guest.locator('.vx-lt-status')).toBeVisible({ timeout: 10_000 });
  await startListeningIfAsked(guest);
  await expect.poll(async () => (await audioState(guest))?.src ?? '', { timeout: 15_000 }).toContain('/t-a.wav');

  // Knock the guest 20 s out of step (a stall, a stray tap on the seek bar):
  // the follower must pull it back within a second of the host.
  await expect.poll(async () => guest.evaluate(() => (window as unknown as { __audio?: HTMLMediaElement }).__audio?.seekable.length ?? 0)).toBeGreaterThan(0);
  await guest.evaluate(() => {
    const a = (window as unknown as { __audio?: HTMLMediaElement }).__audio;
    if (a) a.currentTime = Math.max(0, a.currentTime + 20);
  });
  await expect
    .poll(
      async () => {
        const [h, g] = await Promise.all([audioState(host), audioState(guest)]);
        return h && g ? Math.abs(h.t - g.t) : 99;
      },
      { timeout: 15_000, intervals: [1000] },
    )
    .toBeLessThan(1.0);

  // The host skips from another page; the guest follows.
  await host.getByRole('button', { name: /^Next/ }).first().click();
  await expect.poll(async () => (await audioState(guest))?.src ?? '', { timeout: 15_000 }).toContain('/t-b.wav');

  // The guest also browses away and keeps following, with the pill showing it.
  await guest.getByRole('link', { name: /^Search$/ }).first().click();
  await expect(guest.locator('.vx-lt-pill')).toContainText(/Listening with Asha/);

  // A guest request reaches the host as a full, playable song.
  await guest.goto('/together');
  await guest.getByRole('searchbox', { name: 'Add a song for everyone' }).fill('pick');
  await guest.getByRole('button', { name: 'Add Guest Pick' }).click();
  await expect
    .poll(async () => host.evaluate(() => JSON.parse(localStorage.getItem('vinax.player.v1') ?? '{}')?.state?.queue?.map((s: { id: string; audio?: unknown[] }) => `${s.id}:${s.audio?.length ?? 0}`) ?? []), { timeout: 15_000 })
    .toContain('g1:1');

  // Ending the session tells the guest.
  await host.goto('/together');
  await host.getByRole('button', { name: 'End for everyone' }).click();
  await expect(guest.getByRole('button', { name: 'Start a session' })).toBeVisible({ timeout: 10_000 });

  await host.context().close();
  await guest.context().close();
});

test('a host who reloads the tab is still hosting', async ({ browser, baseURL }) => {
  const base = baseURL!;
  const server = roomServer();
  const host = await open(browser, base, server, 'Asha', [appSong(base, 'a', 'Song A')]);
  await host.goto('/together');
  await host.getByRole('button', { name: 'Start a session' }).click();
  await expect(host.locator('.vx-lt-code')).toHaveText('ABC123');
  await host.reload();
  await expect(host.locator('.vx-lt-code')).toHaveText('ABC123');
  await expect(host.getByRole('button', { name: 'End for everyone' })).toBeVisible();
  await host.context().close();
});

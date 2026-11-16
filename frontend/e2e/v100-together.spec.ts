import { test, expect, type Browser, type Page } from './support/test';
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
 *
 * 1.12.10 — fine sync: a guest starts where the host is, and then closes the
 * last fraction of a second by playing slightly faster or slower. Before, a
 * guest within a second of the host was left there ("a little slow").
 *
 * 1.12.11 — both sides keep the server's clock, the host says at which server
 * moment each position was read, and a guest has a fine-tune for its speaker.
 *
 * 1.13 — the live line: with a stand-in for Supabase Realtime (the Phoenix
 * channel protocol over a routed WebSocket) the host's pause reaches the
 * guest while the host's push to the server is still on its way, chat lines
 * and "typing" show as they happen, reactions rise over the whole screen on
 * any page, and the pill can be dragged out of the way.
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

/**
 * What the real server keeps of a song (backend/worker/functions/api/room.ts,
 * cleanSong): the id and what a room shows. No stream URLs. The stand-in
 * used to hand the host's song back whole, which hid that a guest's player
 * was being given a song it could not play.
 */
function roomSong(raw: unknown): Record<string, unknown> | null {
  const s = raw as Record<string, unknown> | null;
  if (!s || typeof s.id !== 'string') return null;
  const out: Record<string, unknown> = {};
  for (const k of ['id', 'title', 'subtitle', 'duration', 'language', 'year', 'artists', 'images']) if (s[k] !== undefined && s[k] !== null) out[k] = s[k];
  return out;
}
const roomQueue = (raw: unknown): unknown[] =>
  (Array.isArray(raw) ? (raw as Array<{ song?: unknown; by?: unknown; h?: unknown }>) : []).map((t) => ({ song: roomSong(t.song), by: t.by ?? null, ...(typeof t.h === 'string' ? { h: t.h } : {}) })).filter((t) => t.song);
/** 1.14 — how the room shows a member (the real server: 12 hex of SHA-256(code:deviceId)). */
const handleOf = (id: string): string => {
  let x = 0;
  for (const c of id) x = (x * 31 + c.charCodeAt(0)) >>> 0;
  return x.toString(16).padStart(12, '0').slice(-12);
};

interface Room { host_name: string; song: unknown; position: number; playing: boolean; updated_at: string; queue: unknown[]; requests: Array<{ song: { id: string }; by: string }>; messages: Array<{ by: string; text: string; at: string; id?: string }> }
/** Where the stand-in live line is (what /api/room's `live` names). */
const LINE = { url: 'wss://e2e.supabase.co/realtime/v1', key: 'sb_publishable_e2e' };
function roomServer(opts: { line?: boolean; pushDelayMs?: number; jam?: boolean } = {}) {
  const rooms = new Map<string, Room>();
  const members = new Map<string, Map<string, number>>();
  /** 1.14 — the jam (only with `jam`, so the other tests keep a pre-1.14 server): names, settings, commands, who was removed. */
  const names = new Map<string, string>();
  /** 1.14 — the sync protocol each member's heartbeat said (none: an app older than 1.14). */
  const syncs = new Map<string, number>();
  const jam = { guestControl: true, host: null as string | null, controls: [] as Array<Record<string, unknown>>, removed: new Set<string>() };
  /** 1.13 — the phones on the room's live line: what one says, the others hear. */
  const sockets = new Set<{ send(data: string): void }>();
  return {
    rooms,
    /** 1.14 — someone on an app older than 1.14 (it sends no sync protocol) is in the room. */
    addOldMember(code: string, id: string, name: string): void {
      if (!members.has(code)) members.set(code, new Map());
      const beat = () => members.get(code)!.set(id, Date.now());
      beat();
      setInterval(beat, 4000);
      names.set(id, name);
    },
    line: opts.line === true,
    /** How long a host push takes to reach this server (ms): the live line must not wait for it. */
    pushDelayMs: opts.pushDelayMs ?? 0,
    sockets,
    handle(method: string, url: URL, body: Record<string, unknown> | null): unknown {
      if (method === 'GET') {
        const code = url.searchParams.get('code') ?? '';
        const r = rooms.get(code) ?? null;
        const here = [...(members.get(code)?.entries() ?? [])].filter(([id, t]) => Date.now() - t < 12_000 && !jam.removed.has(id)).map(([id]) => id);
        const live = here.length;
        const base = { room: r, memberCount: live, reactions: [], now: Date.now(), took: 0, ...(opts.line ? { live: LINE } : {}) };
        if (!opts.jam || !r) return base;
        const member = url.searchParams.get('member') ?? '';
        return {
          ...base,
          room: { ...r, guestControl: jam.guestControl, hostH: jam.host },
          people: here.map((id) => ({ h: handleOf(id), name: names.get(id) ?? 'Listener', ...(syncs.has(id) ? { sync: syncs.get(id) } : {}) })),
          me: handleOf(member),
          ...(jam.removed.has(member) ? { removed: true } : {}),
          ...(url.searchParams.get('hostToken') === 'tok' ? { controls: jam.controls } : {}),
        };
      }
      const code = String(body?.code ?? '');
      switch (body?.action) {
        case 'create': {
          rooms.set('ABC123', { host_name: String(body.hostName ?? ''), song: roomSong(body.song), position: 0, playing: false, updated_at: new Date().toISOString(), queue: [], requests: [], messages: [] });
          return { code: 'ABC123', hostToken: 'tok' };
        }
        case 'update': {
          const r = rooms.get(code);
          if (!r) return { __status: 404 };
          const consumed = (body.consumedIds as string[]) ?? [];
          // 1.12.11: a host that knows the server's clock says when its position was read.
          const at = typeof body.at === 'number' ? Math.min(Date.now() + 100, Math.max(Date.now() - 5000, body.at)) : Date.now();
          Object.assign(r, { song: roomSong(body.song), position: body.position, playing: body.playing, queue: roomQueue(body.queue), updated_at: new Date(Math.round(at)).toISOString() });
          if (opts.jam && typeof body.guestControl === 'boolean') jam.guestControl = body.guestControl;
          if (opts.jam && typeof body.deviceId === 'string') jam.host = handleOf(body.deviceId);
          r.requests = r.requests.filter((t) => !consumed.includes(t.song.id));
          return { ok: true, took: 0, stamps: true };
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
          names.set(String(body.deviceId), String(body.name ?? ''));
          if (typeof body.sync === 'number') syncs.set(String(body.deviceId), body.sync);
          return { ok: true };
        }
        case 'control': {
          const id = String(body.deviceId);
          if (!opts.jam || !rooms.has(code)) return { __status: 404 };
          if (jam.removed.has(id)) return { __status: 403, error: 'removed' };
          if (['play', 'pause', 'next', 'prev'].includes(String(body.cmd)) && !jam.guestControl) return { __status: 403, error: 'no_control' };
          const song = body.song as { id: string; title?: string } | undefined;
          jam.controls.push({ id: body.id, cmd: body.cmd, h: handleOf(id), by: String(body.name ?? ''), at: new Date().toISOString(), ...(song ? { song: { id: song.id, title: song.title ?? '' } } : {}), ...(body.songId ? { songId: body.songId } : {}) });
          return { ok: true };
        }
        case 'kick': {
          const who = [...(members.get(code)?.keys() ?? [])].find((id) => handleOf(id) === body.who);
          if (!who) return { __status: 404 };
          jam.removed.add(who);
          return { ok: true };
        }
        case 'say': {
          const r = rooms.get(code);
          if (!r) return { __status: 404 };
          const id = typeof body.id === 'string' ? body.id : undefined;
          if (!id || !r.messages.some((m) => m.id === id)) r.messages.push({ by: String(body.name ?? ''), text: String(body.text ?? ''), at: new Date().toISOString(), ...(id ? { id } : {}) });
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
      localStorage.setItem('vinax.settings.v1', JSON.stringify({ state: { theme: 'dark', autoplay: false }, version: 3 }));
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
      // A host push that is slow to arrive: the server knows nothing of it meanwhile.
      if (body?.action === 'update' && server.pushDelayMs) await new Promise((r) => setTimeout(r, server.pushDelayMs));
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
  // 1.13 — the live line: Supabase Realtime's channel protocol, as much of it
  // as the app speaks. A join and a heartbeat are answered; a broadcast is
  // handed to every OTHER phone on the line (the app joins with self: false).
  if (server.line) {
    await page.routeWebSocket(/e2e\.supabase\.co\/realtime\/v1\/websocket/, (ws) => {
      server.sockets.add(ws);
      ws.onClose(() => void server.sockets.delete(ws));
      ws.onMessage((raw) => {
        const m = JSON.parse(String(raw)) as { topic: string; event: string; payload: unknown; ref: string };
        if (m.event === 'phx_join' || m.event === 'heartbeat') ws.send(JSON.stringify({ topic: m.topic, event: 'phx_reply', payload: { status: 'ok', response: {} }, ref: m.ref }));
        else if (m.event === 'broadcast') for (const other of server.sockets) if (other !== ws) other.send(JSON.stringify({ topic: m.topic, event: 'broadcast', payload: m.payload, ref: null }));
      });
    });
  }
  return page;
}

const audioState = (p: Page) =>
  p.evaluate(() => {
    const a = (window as unknown as { __audio?: HTMLMediaElement }).__audio;
    return a ? { src: a.currentSrc || a.src, t: a.currentTime, paused: a.paused } : null;
  });

/** How far apart the two players are (seconds); both are read in the same instant. */
async function gap(host: Page, guest: Page): Promise<number> {
  const [h, g] = await Promise.all([audioState(host), audioState(guest)]);
  return h && g ? Math.abs(h.t - g.t) : 99;
}

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
  await host.getByRole('link', { name: /^What do you want to play/ }).first().click();
  await expect(host.locator('.vx-lt-pill')).toContainText('Hosting');

  // The host is a minute into the song when the guest arrives.
  await expect.poll(async () => host.evaluate(() => (window as unknown as { __audio?: HTMLMediaElement }).__audio?.seekable.length ?? 0)).toBeGreaterThan(0);
  await host.evaluate(() => {
    const a = (window as unknown as { __audio?: HTMLMediaElement }).__audio;
    if (a) a.currentTime = 60;
  });
  await expect.poll(() => server.rooms.get('ABC123')?.position ?? 0, { timeout: 10_000 }).toBeGreaterThan(55);

  // Guest: the invite link joins by itself.
  await guest.goto('/together?code=ABC123');
  await expect(guest.locator('.vx-lt-status')).toBeVisible({ timeout: 10_000 });
  await startListeningIfAsked(guest);
  await expect.poll(async () => (await audioState(guest))?.src ?? '', { timeout: 15_000 }).toContain('/t-a.wav');

  // The guest comes in where the host is (a minute into the song), not at
  // 0:00 with a jump a few seconds later…
  await expect.poll(async () => (await audioState(guest))?.paused, { timeout: 10_000 }).toBe(false);
  await expect.poll(async () => (await audioState(guest))?.t ?? 0, { timeout: 5_000, intervals: [50] }).toBeGreaterThan(0.2);
  expect((await audioState(guest))?.t ?? 0).toBeGreaterThan(55);
  // …and then closes the last fraction of a second: the two players end up
  // together, not "the host a little ahead".
  await expect.poll(() => gap(host, guest), { timeout: 25_000, intervals: [500] }).toBeLessThan(0.08);

  // Knock the guest 20 s out of step (a stall, a stray tap on the seek bar):
  // the follower must pull it back within a second of the host.
  await expect.poll(async () => guest.evaluate(() => (window as unknown as { __audio?: HTMLMediaElement }).__audio?.seekable.length ?? 0)).toBeGreaterThan(0);
  await guest.evaluate(() => {
    const a = (window as unknown as { __audio?: HTMLMediaElement }).__audio;
    if (a) a.currentTime = Math.max(0, a.currentTime + 20);
  });
  await expect.poll(() => gap(host, guest), { timeout: 15_000, intervals: [1000] }).toBeLessThan(1.0);
  // The seek gets it close; the fine sync finishes the job.
  await expect.poll(() => gap(host, guest), { timeout: 25_000, intervals: [500] }).toBeLessThan(0.08);

  // The host skips from another page; the guest follows.
  await host.getByRole('button', { name: /^Next/ }).first().click();
  await expect.poll(async () => (await audioState(guest))?.src ?? '', { timeout: 15_000 }).toContain('/t-b.wav');

  // The guest also browses away and keeps following, with the pill showing it.
  await guest.getByRole('link', { name: /^What do you want to play/ }).first().click();
  await expect(guest.locator('.vx-lt-pill')).toContainText(/Listening with Asha/);

  // 1.13 — a song the guest taps on another page is ASKED of the host: it
  // joins the host's queue as a playable song, and the guest's own player
  // stays on the host's song. (It used to play here for a second, until the
  // room took it away.)
  // (The guest is on Search already: "Trending now" lists the catalogue's songs.)
  await guest.getByRole('button', { name: /^Play Another Pick/ }).first().click();
  await expect(guest.getByText(/Asked Asha for “Another Pick”/)).toBeVisible({ timeout: 10_000 });
  await expect
    .poll(async () => host.evaluate(() => JSON.parse(localStorage.getItem('vinax.player.v1') ?? '{}')?.state?.queue?.map((s: { id: string; audio?: unknown[] }) => `${s.id}:${s.audio?.length ?? 0}`) ?? []), { timeout: 15_000 })
    .toContain('g2:1');
  expect((await audioState(guest))?.src ?? '').not.toContain('/t-g2.wav');
  // The host is told who asked (the song by the catalogue's own name for it)
  // and can bring it on at once: everyone then hears it.
  await expect(host.getByText('Ravi added “Song g2”')).toBeVisible({ timeout: 10_000 });
  await host.getByRole('button', { name: 'Play now' }).click();
  await expect.poll(async () => (await audioState(host))?.src ?? '', { timeout: 10_000 }).toContain('/t-g2.wav');
  await expect.poll(async () => (await audioState(guest))?.src ?? '', { timeout: 15_000 }).toContain('/t-g2.wav');

  // A guest request reaches the host as a full, playable song.
  await guest.goto('/together');
  await guest.getByRole('searchbox', { name: 'Add to the queue' }).fill('pick');
  await guest.getByRole('button', { name: 'Add Guest Pick' }).click();
  await expect
    .poll(async () => host.evaluate(() => JSON.parse(localStorage.getItem('vinax.player.v1') ?? '{}')?.state?.queue?.map((s: { id: string; audio?: unknown[] }) => `${s.id}:${s.audio?.length ?? 0}`) ?? []), { timeout: 15_000 })
    .toContain('g1:1');

  // 1.12.11 — fine-tune: this phone's speaker is slow to sound, so the guest
  // sets it 100 ms earlier and is held that far ahead of the host's signal;
  // Reset brings it back onto it.
  await startListeningIfAsked(guest);
  const ahead = async (): Promise<number> => {
    const [h, g] = await Promise.all([audioState(host), audioState(guest)]);
    return h && g && !g.paused ? g.t - h.t : -99;
  };
  const tune = guest.getByRole('group', { name: 'Fine-tune this phone' });
  for (let i = 0; i < 10; i += 1) await tune.getByRole('button', { name: 'Play this phone 10 milliseconds earlier' }).click();
  await expect(tune).toContainText('+100 ms');
  await expect.poll(ahead, { timeout: 25_000, intervals: [500] }).toBeGreaterThan(0.06);
  await expect.poll(ahead, { timeout: 10_000, intervals: [500] }).toBeLessThan(0.14);
  expect(await guest.evaluate(() => localStorage.getItem('vinax.together-trim.v1'))).toBe('100');
  await tune.getByRole('button', { name: 'Reset' }).click();
  await expect(tune).toContainText('0 ms');
  await expect.poll(() => gap(host, guest), { timeout: 25_000, intervals: [500] }).toBeLessThan(0.08);

  // Ending the session tells the guest.
  await host.goto('/together');
  await host.getByRole('button', { name: 'End for everyone' }).click();
  await expect(guest.getByRole('button', { name: 'Start a session' })).toBeVisible({ timeout: 10_000 });

  await host.context().close();
  await guest.context().close();
});

test('with the live line, a pause, a chat line, "typing" and a reaction reach the guest as they happen', async ({ browser, baseURL }) => {
  const base = baseURL!;
  // Every host push takes 3 s to reach the server: by polling alone the guest
  // could not hear of a pause before then.
  const server = roomServer({ line: true, pushDelayMs: 3000 });
  const host = await open(browser, base, server, 'Asha', [appSong(base, 'a', 'Song A'), appSong(base, 'b', 'Song B')]);
  const guest = await open(browser, base, server, 'Ravi', []);

  await host.goto('/together');
  await host.getByRole('button', { name: 'Start a session' }).click();
  await expect(host.locator('.vx-lt-code')).toHaveText('ABC123');
  await host.getByRole('button', { name: /^Play$/ }).first().click();
  await expect.poll(async () => (await audioState(host))?.paused, { timeout: 10_000 }).toBe(false);
  await expect.poll(() => server.rooms.get('ABC123')?.playing ?? false, { timeout: 15_000 }).toBe(true);

  await guest.goto('/together?code=ABC123');
  await expect(guest.locator('.vx-lt-status')).toBeVisible({ timeout: 10_000 });
  await startListeningIfAsked(guest);
  await expect.poll(async () => (await audioState(guest))?.paused, { timeout: 15_000 }).toBe(false);
  // Both are on the line: the room says so.
  await expect(host.locator('.vx-lt-instant')).toBeVisible({ timeout: 10_000 });
  await expect(guest.locator('.vx-lt-instant')).toBeVisible({ timeout: 10_000 });
  await expect.poll(() => gap(host, guest), { timeout: 25_000, intervals: [500] }).toBeLessThan(0.15);

  // The host pauses. The server will not know for 3 s; the guest stops now,
  // where the host stopped…
  await host.getByRole('button', { name: /^Pause$/ }).first().click();
  await expect.poll(async () => (await audioState(guest))?.paused, { timeout: 1500, intervals: [50] }).toBe(true);
  expect(server.rooms.get('ABC123')?.playing).toBe(true);
  await expect.poll(() => gap(host, guest), { timeout: 2000, intervals: [100] }).toBeLessThan(0.1);
  // …and the polls that still say "playing" meanwhile do not start it again.
  await guest.waitForTimeout(2500);
  expect((await audioState(guest))?.paused).toBe(true);
  // Play again: the guest is back with the host at once.
  await expect.poll(() => server.rooms.get('ABC123')?.playing, { timeout: 10_000 }).toBe(false);
  await host.getByRole('button', { name: /^Play$/ }).first().click();
  await expect.poll(async () => (await audioState(guest))?.paused, { timeout: 1500, intervals: [50] }).toBe(false);
  await expect.poll(() => gap(host, guest), { timeout: 25_000, intervals: [500] }).toBeLessThan(0.1);

  // Chat. The guest sees that the host is typing, then the line: once, also
  // after the server has listed it; the host's own line is on its right.
  const hostChat = host.getByRole('textbox', { name: 'Chat message' });
  await hostChat.pressSequentially('hello ravi', { delay: 20 });
  await expect(guest.locator('.vx-lt-typing')).toContainText('Asha is typing', { timeout: 2000 });
  await host.getByRole('button', { name: 'Send' }).click();
  await expect(host.locator('.vx-lt-msg[data-mine] .vx-lt-bubble')).toHaveText('hello ravi');
  await expect(guest.locator('.vx-lt-msg:not([data-mine]) .vx-lt-bubble')).toHaveText('hello ravi', { timeout: 2000 });
  await expect(guest.locator('.vx-lt-msg').first()).toContainText('Asha');
  await expect(guest.locator('.vx-lt-typing')).toHaveText('');
  await guest.getByRole('textbox', { name: 'Chat message' }).fill('hi asha');
  await guest.getByRole('textbox', { name: 'Chat message' }).press('Enter');
  await expect(host.locator('.vx-lt-msg:not([data-mine]) .vx-lt-bubble')).toHaveText('hi asha', { timeout: 2000 });
  // Two polls later each screen still shows each line once, and whose it is.
  await host.waitForTimeout(4500);
  await expect(host.locator('.vx-lt-bubble')).toHaveText(['hello ravi', 'hi asha']);
  await expect(guest.locator('.vx-lt-bubble')).toHaveText(['hello ravi', 'hi asha']);
  await expect(host.locator('.vx-lt-msg[data-mine] .vx-lt-bubble')).toHaveText('hello ravi');
  await expect(guest.locator('.vx-lt-msg[data-mine] .vx-lt-bubble')).toHaveText('hi asha');

  // A reaction rises over the whole screen on the guest too, with who sent
  // it, and fills the room's energy on both.
  await host.getByRole('button', { name: 'React 🔥' }).click();
  await expect(guest.locator('.vx-lt-sky .vx-lt-fly-by')).toHaveText('Asha', { timeout: 2000 });
  await expect(guest.getByRole('meter', { name: 'Room energy' })).toHaveAttribute('aria-valuenow', /^[1-9]/);
  const sky = await guest.locator('.vx-lt-sky').boundingBox();
  const view = guest.viewportSize()!;
  expect(sky?.width).toBe(view.width);
  expect(sky?.height).toBe(view.height);
  // …and on any other page of the app.
  await guest.getByRole('link', { name: /^What do you want to play/ }).first().click();
  await expect(guest.locator('.vx-lt-pill')).toBeVisible();
  await host.getByRole('button', { name: 'React ❤️' }).click();
  await expect(guest.locator('.vx-lt-sky .vx-lt-fly').first()).toBeVisible({ timeout: 2000 });

  // Ten reactions together fill the bar: the room goes off on both screens.
  for (let i = 0; i < 10; i += 1) await host.getByRole('button', { name: 'React 🎉' }).click();
  await expect(guest.locator('.vx-lt-burst')).toBeVisible({ timeout: 3000 });
  await expect(host.locator('.vx-lt-burst')).toBeVisible();

  await host.context().close();
  await guest.context().close();
});

test('a jam: the guest pauses, plays, adds, takes out and skips for everyone; the host keeps control or removes them', async ({ browser, baseURL }) => {
  const base = baseURL!;
  const server = roomServer({ jam: true });
  const host = await open(browser, base, server, 'Asha', [appSong(base, 'a', 'Song A'), appSong(base, 'b', 'Song B')]);
  const guest = await open(browser, base, server, 'Ravi', []);
  const hostQueue = () => host.evaluate(() => JSON.parse(localStorage.getItem('vinax.player.v1') ?? '{}')?.state?.queue?.map((s: { id: string }) => s.id) ?? []);

  await host.goto('/together');
  await host.getByRole('button', { name: 'Start a session' }).click();
  await expect(host.locator('.vx-lt-code')).toHaveText('ABC123');
  await host.getByRole('button', { name: 'Play for everyone' }).click();
  await expect.poll(async () => (await audioState(host))?.paused, { timeout: 10_000 }).toBe(false);

  await guest.goto('/together?code=ABC123');
  await expect(guest.locator('.vx-lt-status')).toBeVisible({ timeout: 10_000 });
  await startListeningIfAsked(guest);
  await expect.poll(async () => (await audioState(guest))?.paused, { timeout: 15_000 }).toBe(false);

  // Everyone sees who is here, with the host marked; both apps are new enough.
  const people = guest.locator('section[aria-labelledby="vx-lt-people"]');
  await expect(people).toContainText('Asha', { timeout: 10_000 });
  await expect(people.locator('.vx-lt-tag').first()).toHaveText('Host');
  await expect(people.getByText('Old app')).toHaveCount(0);
  await expect(guest.locator('.vx-lt-warn')).toHaveCount(0);

  // 1.14 — the guest's sync check: in step, the instant connection's state, and Resync.
  const check = guest.getByRole('group', { name: 'Sync check' });
  await expect(check.getByTestId('lt-offset')).toContainText('In step', { timeout: 25_000 });
  await expect(check).toContainText('Instant connection');
  await check.getByRole('button', { name: 'Resync' }).click();
  await expect(guest.getByText('Syncing with the host…')).toBeVisible();
  await expect.poll(() => gap(host, guest), { timeout: 25_000, intervals: [500] }).toBeLessThan(0.08);

  // Someone joins on an app older than 1.14: everyone is told whose app to update.
  server.addOldMember('ABC123', 'old-device', 'Kiran');
  await expect(host.locator('.vx-lt-warn')).toContainText('Kiran’s VinaX is out of date', { timeout: 10_000 });
  await expect(people.locator('li', { hasText: 'Kiran' }).getByText('Old app')).toBeVisible({ timeout: 10_000 });

  // The guest pauses the room: the HOST's music stops, and so does the guest's.
  await guest.getByRole('button', { name: 'Pause for everyone' }).click();
  await expect.poll(async () => (await audioState(host))?.paused, { timeout: 10_000 }).toBe(true);
  await expect.poll(async () => (await audioState(guest))?.paused, { timeout: 10_000 }).toBe(true);
  await expect(host.getByText('Ravi paused')).toBeVisible();
  await guest.getByRole('button', { name: 'Play for everyone' }).click();
  await expect.poll(async () => (await audioState(host))?.paused, { timeout: 10_000 }).toBe(false);

  // A song the guest adds goes straight into the queue, with their name on it…
  await guest.getByRole('searchbox', { name: 'Add to the queue' }).fill('pick');
  await guest.getByRole('button', { name: 'Add Guest Pick' }).click();
  await expect(guest.getByText('Added “Guest Pick” to the queue')).toBeVisible({ timeout: 10_000 });
  await expect.poll(hostQueue, { timeout: 15_000 }).toContain('g1');
  const hostRow = host.locator('section[aria-label="Up next"] li', { hasText: 'Song g1' });
  await expect(hostRow.locator('.vx-lt-added .truncate-1')).toHaveText('Ravi', { timeout: 10_000 });
  const guestRow = guest.locator('section[aria-label="Up next"] li', { hasText: 'Song g1' });
  await expect(guestRow.locator('.vx-lt-added .truncate-1')).toHaveText('You', { timeout: 10_000 });
  await guest.screenshot({ path: test.info().outputPath('jam-guest.png'), fullPage: true });
  await host.screenshot({ path: test.info().outputPath('jam-host.png'), fullPage: true });
  // …and they can take it out again; a song they did not add has no cross.
  await expect(guest.locator('section[aria-label="Up next"] li', { hasText: 'Song B' }).getByRole('button', { name: /out of the queue/ })).toHaveCount(0);
  await guestRow.getByRole('button', { name: 'Take Song g1 out of the queue' }).click();
  await expect.poll(hostQueue, { timeout: 15_000 }).not.toContain('g1');

  // The guest skips for everyone.
  await guest.getByRole('button', { name: 'Next song' }).click();
  await expect.poll(async () => (await audioState(host))?.src ?? '', { timeout: 10_000 }).toContain('/t-b.wav');
  await expect.poll(async () => (await audioState(guest))?.src ?? '', { timeout: 15_000 }).toContain('/t-b.wav');

  // The host keeps playback to itself: the guest's buttons go quiet and a vote to skip comes back.
  await host.getByRole('switch', { name: 'Guests can control playback' }).click();
  await expect(guest.getByRole('button', { name: /for everyone$/ })).toBeDisabled({ timeout: 10_000 });
  await expect(guest.getByRole('button', { name: 'Vote to skip this song' })).toBeVisible();

  // The host removes the guest: they are out, and told.
  await host.getByRole('button', { name: 'Remove Ravi from the session' }).click();
  await host.getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(guest.getByText('Asha removed you from this session')).toBeVisible({ timeout: 10_000 });
  await expect(guest.getByRole('button', { name: 'Start a session' })).toBeVisible();
  await expect(host.locator('section[aria-labelledby="vx-lt-people"]')).not.toContainText('Ravi', { timeout: 10_000 });

  await host.context().close();
  await guest.context().close();
});

test('new chat lines count up on the pill until the chat is opened, and the player’s Together tab has the chat', async ({ browser, baseURL }) => {
  const base = baseURL!;
  const server = roomServer({ line: true, jam: true });
  const host = await open(browser, base, server, 'Asha', [appSong(base, 'a', 'Song A'), appSong(base, 'b', 'Song B')]);
  const guest = await open(browser, base, server, 'Ravi', []);
  await host.goto('/together');
  await host.getByRole('button', { name: 'Start a session' }).click();
  await expect(host.locator('.vx-lt-code')).toHaveText('ABC123');
  await host.getByRole('button', { name: 'Play for everyone' }).click();
  await guest.goto('/together?code=ABC123');
  await expect(guest.locator('.vx-lt-status')).toBeVisible({ timeout: 10_000 });
  await startListeningIfAsked(guest);
  await expect(guest.locator('.vx-lt-status')).toContainText('Live', { timeout: 15_000 });

  // The guest is browsing elsewhere when the host says something.
  await guest.getByRole('link', { name: /^What do you want to play/ }).first().click();
  const pill = guest.locator('.vx-lt-pill');
  await expect(pill).toBeVisible();
  await expect(pill.getByTestId('lt-unread')).toHaveCount(0);
  const say = async (text: string) => {
    await host.getByRole('textbox', { name: 'Chat message' }).fill(text);
    await host.getByRole('button', { name: 'Send' }).click();
  };
  await say('first');
  await expect(pill.getByTestId('lt-unread')).toHaveText('1', { timeout: 10_000 });
  await say('second');
  await expect(pill.getByTestId('lt-unread')).toHaveText('2', { timeout: 10_000 });
  await expect(pill.getByRole('link')).toHaveAttribute('aria-label', /2 new messages/);
  await guest.screenshot({ path: test.info().outputPath('unread-pill.png') });

  // Opening the room reads them.
  await pill.getByRole('link').click();
  await expect(guest.locator('.vx-lt-msg', { hasText: 'second' })).toBeVisible();
  await guest.getByRole('link', { name: /^What do you want to play/ }).first().click();
  await expect(guest.locator('.vx-lt-pill')).toBeVisible();
  await expect(guest.locator('.vx-lt-pill').getByTestId('lt-unread')).toHaveCount(0);

  // The player's Together tab: the count shows on the tab, and the chat is right there.
  await say('third');
  await expect(guest.locator('.vx-lt-pill').getByTestId('lt-unread')).toHaveText('1', { timeout: 10_000 });
  // In the app (a reload would start the count afresh): the Now playing rail's Full screen.
  await guest.getByRole('link', { name: /Full screen/ }).first().click();
  await expect(guest).toHaveURL(/\/now-playing/);
  const tab = guest.getByRole('tab', { name: 'Together' });
  await expect(tab.locator('.vx-np-tab-badge')).toHaveText('1', { timeout: 10_000 });
  await tab.click();
  const panel = guest.locator('#vx-np-panel-together');
  await expect(panel.locator('.vx-lt-msg', { hasText: 'third' })).toBeVisible({ timeout: 10_000 });
  await expect(tab.locator('.vx-np-tab-badge')).toHaveCount(0);
  // The tab carries the room here: no pill on top of the chat's Send button.
  await expect(guest.locator('.vx-lt-pill')).toHaveCount(0);
  await panel.getByRole('textbox', { name: 'Chat message' }).fill('from the player');
  await panel.getByRole('button', { name: 'Send' }).click();
  await expect(host.locator('.vx-lt-msg', { hasText: 'from the player' })).toBeVisible({ timeout: 10_000 });
  await guest.screenshot({ path: test.info().outputPath('unread-tab.png'), fullPage: true });

  await host.context().close();
  await guest.context().close();
});

test('the Listen Together pill can be dragged out of the way, stays there, and a tap still opens the room', async ({ browser, baseURL }) => {
  const base = baseURL!;
  const server = roomServer();
  const host = await open(browser, base, server, 'Asha', [appSong(base, 'a', 'Song A')]);
  await host.goto('/together');
  await host.getByRole('button', { name: 'Start a session' }).click();
  await expect(host.locator('.vx-lt-code')).toHaveText('ABC123');
  await host.getByRole('link', { name: /^What do you want to play/ }).first().click();
  const pill = host.locator('.vx-lt-pill');
  await expect(pill).toContainText('Hosting');
  // The pill sits above the player, which takes a moment to reach its height.
  const settled = async () => {
    let a = await pill.boundingBox();
    for (;;) {
      await host.waitForTimeout(200);
      const b = await pill.boundingBox();
      if (a && b && Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5) return b;
      a = b;
    }
  };
  // Press on the pill. Its label and the player under it can still shift it a
  // few pixels after it looks settled, so where the pointer holds it is read
  // after the press, from the pill itself (a press does not move it).
  let grab = { x: 0, y: 0 };
  for (let attempt = 0; ; attempt += 1) {
    const at = await settled();
    const px = at.x + at.width / 2;
    const py = at.y + at.height / 2;
    await host.mouse.move(px, py);
    await host.mouse.down();
    const held = (await pill.boundingBox())!;
    if (px >= held.x && px <= held.x + held.width && py >= held.y && py <= held.y + held.height) {
      grab = { x: px - held.x, y: py - held.y };
      break;
    }
    await host.mouse.up();
    expect(attempt, 'the pill kept moving under the pointer').toBeLessThan(3);
  }

  // Drag it to the top left.
  await host.mouse.move(400, 300, { steps: 8 });
  await host.mouse.move(120 + grab.x, 140 + grab.y, { steps: 8 });
  await host.mouse.up();
  const moved = (await pill.boundingBox())!;
  expect(Math.abs(moved.x - 120)).toBeLessThan(4);
  expect(Math.abs(moved.y - 140)).toBeLessThan(4);
  // Letting go is not a tap: the listener is still on Search.
  await host.waitForTimeout(400);
  expect(new URL(host.url()).pathname).toBe('/search');

  // It cannot be dragged off the screen.
  await host.mouse.move(moved.x + moved.width / 2, moved.y + moved.height / 2);
  await host.mouse.down();
  await host.mouse.move(-400, -400, { steps: 6 });
  await host.mouse.up();
  const edge = (await pill.boundingBox())!;
  expect(edge.x).toBeGreaterThanOrEqual(0);
  expect(edge.y).toBeGreaterThanOrEqual(0);

  // It is where it was left after a reload, and on a smaller window it is still on screen.
  await host.reload();
  await expect(pill).toContainText('Hosting');
  const kept = (await pill.boundingBox())!;
  expect(Math.abs(kept.x - edge.x)).toBeLessThan(4);
  expect(Math.abs(kept.y - edge.y)).toBeLessThan(4);
  await host.setViewportSize({ width: 390, height: 780 });
  const small = (await pill.boundingBox())!;
  expect(small.x).toBeGreaterThanOrEqual(0);
  expect(small.x + small.width).toBeLessThanOrEqual(390);
  await host.setViewportSize({ width: 1280, height: 860 });

  // A tap still opens the room.
  await pill.click();
  await expect(host).toHaveURL(/\/together$/);
  await host.context().close();
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

/**
 * 1.12.12 — the Listen Together tours, walked in a real browser. Every step
 * that names a control must be spotlighted on it (never a card centred over
 * nothing), with the spotlight and the card both on screen and the card not
 * lying on the control. A step whose control this role does not have is
 * skipped by the runner, so the titles a walk collects are the role's own.
 */
interface TourStep { title: string; anchor: string | null }
async function walkTour(p: Page): Promise<TourStep[]> {
  const tour = p.locator('.vx-tut');
  const seen: TourStep[] = [];
  for (let i = 0; i < 24; i += 1) {
    // A step with a missing anchor waits 2.5 s before it is skipped.
    await expect(tour).toHaveAttribute('data-ready', 'true', { timeout: 12_000 });
    const anchor = await tour.getAttribute('data-anchor');
    const title = await tour.locator('h2').innerText();
    const view = p.viewportSize()!;
    let card = (await tour.locator('.vx-tut-card').boundingBox())!;
    expect(card.y, `${title}: card top`).toBeGreaterThanOrEqual(0);
    expect(card.y + card.height, `${title}: card bottom`).toBeLessThanOrEqual(view.height + 1);
    expect(card.x, `${title}: card left`).toBeGreaterThanOrEqual(0);
    expect(card.x + card.width, `${title}: card right`).toBeLessThanOrEqual(view.width + 1);
    if (anchor !== 'none') {
      await expect(tour, `${title}: spotlight`).toHaveAttribute('data-anchor', 'found');
      // The spotlight glides to its control (and follows a page still scrolling): measure it at rest.
      let spot = (await tour.locator('.vx-tut-spot').boundingBox())!;
      for (let n = 0; n < 20; n += 1) {
        await p.waitForTimeout(150);
        const now = (await tour.locator('.vx-tut-spot').boundingBox())!;
        const still = Math.abs(now.y - spot.y) < 0.5 && Math.abs(now.x - spot.x) < 0.5 && Math.abs(now.height - spot.height) < 0.5;
        spot = now;
        if (still) break;
      }
      card = (await tour.locator('.vx-tut-card').boundingBox())!;
      expect(spot.y, `${title}: spotlight top`).toBeGreaterThanOrEqual(-1);
      expect(spot.y + spot.height, `${title}: spotlight bottom`).toBeLessThanOrEqual(view.height + 1);
      const apart = card.y >= spot.y + spot.height - 1 || card.y + card.height <= spot.y + 1;
      expect(apart, `${title}: the card lies on its control`).toBe(true);
    }
    // Read again: the first read can land while the spotlight is still finding its control ('pending').
    seen.push({ title, anchor: await tour.getAttribute('data-anchor') });
    const done = tour.getByRole('button', { name: 'Done' });
    if (await done.isVisible()) {
      await done.click();
      await expect(tour).toHaveCount(0);
      return seen;
    }
    const step = await tour.getAttribute('data-step');
    await tour.getByRole('button', { name: 'Next' }).click();
    await expect(tour).not.toHaveAttribute('data-step', step ?? '');
  }
  throw new Error('the tour never reached Done');
}
const titles = (steps: TourStep[]): string[] => steps.map((s) => s.title);

for (const size of [{ name: 'a computer', width: 1280, height: 860 }, { name: 'a phone', width: 390, height: 844 }]) {
  test(`the Listen Together tour introduces the page and points at its real buttons, on ${size.name}`, async ({ browser, baseURL }) => {
    const base = baseURL!;
    const page = await open(browser, base, roomServer(), 'Asha', []);
    await page.setViewportSize({ width: size.width, height: size.height });
    await page.goto('/together');

    // A first visit is offered the tour.
    const intro = page.getByRole('region', { name: 'Take the one-minute tour' });
    await expect(intro).toBeVisible();
    await intro.getByRole('button', { name: 'Show me how' }).click();

    const steps = await walkTour(page);
    expect(titles(steps)).toEqual([
      'Meet Listen Together', 'Host a session', 'Bring your friends', 'Join with a code', 'Or scan the QR',
      'A link joins by itself', 'Tap to start listening', 'From the player too', 'The Live pill', 'Inside the room',
    ]);
    expect(steps.slice(1, 5).map((s) => s.anchor)).toEqual(['found', 'found', 'found', 'found']);
    // Nothing was started by the tour, and it is not offered again.
    await expect(page.getByRole('button', { name: 'Start a session' })).toBeVisible();
    await expect(intro).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Replay the tour' })).toBeVisible();
    await page.context().close();
  });
}

test('“Not now” puts the tour offer away for good, and the room tour asks for a room first', async ({ browser, baseURL }) => {
  const base = baseURL!;
  const server = roomServer();
  const page = await open(browser, base, server, 'Asha', []);
  await page.goto('/together');
  const intro = page.getByRole('region', { name: 'Take the one-minute tour' });
  await intro.getByRole('button', { name: 'Not now' }).click();
  await expect(intro).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('button', { name: 'How it works' })).toBeVisible();
  await expect(intro).toHaveCount(0);

  // The room tour needs a room: from Help it says so instead of pointing at nothing.
  await page.goto('/help');
  await page.getByRole('button', { name: /Inside a room/ }).click();
  await expect(page.getByText('Start or join a room first. This tour runs inside it.')).toBeVisible();
  await expect(page.locator('.vx-tut')).toHaveCount(0);
  await page.context().close();
});

for (const size of [{ name: 'a computer', width: 1280, height: 860 }, { name: 'a phone', width: 390, height: 844 }]) {
  test(`“Show me around” tours a live room for the host and for a guest, on ${size.name}`, async ({ browser, baseURL }) => {
    const base = baseURL!;
    const server = roomServer();
    const host = await open(browser, base, server, 'Asha', [appSong(base, 'a', 'Song A'), appSong(base, 'b', 'Song B')]);
    const guest = await open(browser, base, server, 'Ravi', []);
    await host.setViewportSize({ width: size.width, height: size.height });
    await guest.setViewportSize({ width: size.width, height: size.height });

    await host.goto('/together');
    await host.getByRole('button', { name: 'Start a session' }).click();
    await expect(host.locator('.vx-lt-code')).toHaveText('ABC123');
    await host.getByRole('button', { name: 'Show me around' }).click();
    const asHost = await walkTour(host);
    // A host has Share invite and no fine-tune.
    expect(titles(asHost)).toEqual(['You are live', 'Room code and QR', 'Share the invite', 'Play, pause and skip', 'React', 'Chat', 'Add a song', 'Who is here', 'End or leave']);
    expect(asHost.every((s) => s.anchor === 'found')).toBe(true);
    // The tour ended nothing, and is now a quiet replay button.
    await expect(host.locator('.vx-lt-code')).toHaveText('ABC123');
    await expect(host.getByRole('button', { name: 'Replay the room tour' })).toBeVisible();

    await guest.goto('/together?code=ABC123');
    await expect(guest.locator('.vx-lt-status')).toBeVisible({ timeout: 10_000 });
    await startListeningIfAsked(guest);
    await guest.getByRole('button', { name: 'Show me around' }).click();
    const asGuest = await walkTour(guest);
    // A guest has the fine-tune and no Share invite.
    expect(titles(asGuest)).toEqual(['You are live', 'Room code and QR', 'Play, pause and skip', 'Fine-tune this phone', 'React', 'Chat', 'Add a song', 'Who is here', 'End or leave']);
    expect(asGuest.every((s) => s.anchor === 'found')).toBe(true);
    await expect(guest.getByRole('button', { name: 'Leave session' })).toBeVisible();

    await host.context().close();
    await guest.context().close();
  });
}

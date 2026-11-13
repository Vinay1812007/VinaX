/* global window, localStorage, HTMLMediaElement, performance, setTimeout, URL */
/**
 * Listen Together, measured: how far apart are a host and a guest really?
 *
 *   npm run build && node scripts/together-measure.mjs
 *
 * Two real Chrome sessions (system Chrome: the bundled Chromium has no AAC)
 * run the BUILT app. The catalogue and the audio are the live ones; the room
 * is a stand-in that behaves like this build's Worker (server clock, `took`,
 * `at` on a push) behind a slow database, with network delay and jitter
 * added per device. Every half second it prints both playheads and
 * guest - host in ms, read in the same instant, then the last 15 s' mean.
 * `ROOM=live` uses the deployed room API instead (it creates a real room).
 *
 * Settings (environment): SECONDS=60, HOST_LATENCY / GUEST_LATENCY (ms each
 * way), HOST_UP / GUEST_UP (extra ms on the way up only), JITTER (random
 * extra ms each way), HOST_HEADSTART (ms the host plays before the guest
 * joins), SEEK_AT / NEXT_AT / PAUSE_AT (the half-second tick at which the
 * host seeks +40 s, skips, or pauses for 3 s), QUERY / QUERY2 (songs to
 * search), ONE_SONG=1 (queue only one).
 *
 * This is how 1.12.11's numbers were found: 40 to 75 ms apart and 14 s to
 * recover from a pause before; within about 10 ms and 3 s after.
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const PORT = Number(process.env.PORT ?? 4392);
const BASE = `http://localhost:${PORT}`;
const LIVE = 'https://www.vinaxmusic.online';
const SECONDS = Number(process.env.SECONDS ?? 60);
const GUEST_LATENCY = Number(process.env.GUEST_LATENCY ?? 0); // extra ms each way for the guest's API calls
const HOST_LATENCY = Number(process.env.HOST_LATENCY ?? 0);
const QUERY = process.env.QUERY ?? 'Samajavaragamana';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A stand-in for /api/room that behaves like the Worker in this build
// (server clock, `took`, `at` on a push) with a database that takes a while.
const rooms = new Map();
const members = new Map();
const dbTime = () => 120 + Math.random() * 180;
async function simRoom(method, url, body) {
  const arrived = Date.now();
  await sleep(dbTime());
  if (method === 'GET') {
    const code = url.searchParams.get('code') ?? '';
    const live = [...(members.get(code)?.values() ?? [])].filter((t) => Date.now() - t < 12000).length;
    return { room: rooms.get(code) ?? null, now: arrived, took: Date.now() - arrived, memberCount: live, reactions: [], names: [] };
  }
  const code = String(body?.code ?? '');
  const clean = (x) => { if (!x || typeof x.id !== 'string') return null; const o = {}; for (const k of ['id', 'title', 'subtitle', 'duration', 'language', 'year', 'artists', 'images']) if (x[k] != null) o[k] = x[k]; return o; };
  switch (body?.action) {
    case 'create':
      rooms.set('SIM123', { host_name: String(body.hostName ?? ''), song: clean(body.song), position: 0, playing: false, updated_at: new Date(arrived).toISOString(), queue: [], requests: [] });
      return { code: 'SIM123', hostToken: 'tok' };
    case 'update': {
      const r = rooms.get(code);
      if (!r) return { __status: 404 };
      const at = typeof body.at === 'number' ? Math.round(Math.min(arrived + 100, Math.max(arrived - 5000, body.at))) : arrived;
      Object.assign(r, { song: clean(body.song), position: body.position, playing: body.playing, updated_at: new Date(at).toISOString() });
      return { ok: true, took: Date.now() - arrived, stamps: true };
    }
    case 'heartbeat':
      if (!members.has(code)) members.set(code, new Map());
      members.get(code).set(String(body.deviceId), Date.now());
      return { ok: true };
    case 'end': rooms.delete(code); return { ok: true };
    default: return { ok: true };
  }
}
const SIM = process.env.ROOM !== 'live';

async function open(browser, who, latency) {
  const ctx = await browser.newContext({ baseURL: BASE, viewport: { width: 1280, height: 860 } });
  await ctx.addInitScript(({ who }) => {
    localStorage.setItem('vinax.account.v1', JSON.stringify({ session: 'vx1.e2e.test', user: { name: who, email: 'tester@example.com', picture: null, username: who.toLowerCase() } }));
    localStorage.setItem('vinax.onboarded.v1', 'true');
    localStorage.setItem('vinax.user-name', JSON.stringify(who));
    localStorage.setItem('vinax.user-handle', JSON.stringify(who.toLowerCase()));
    localStorage.setItem('vinax.analytics-consent', 'false');
    if (!localStorage.getItem('vinax.settings.v1')) localStorage.setItem('vinax.settings.v1', JSON.stringify({ state: { theme: 'dark', autoplay: false }, version: 3 }));
    const orig = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () { if (!this.muted) window.__audio = this; return orig.call(this); };
  }, { who });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log(`[${who}] pageerror ${e.message}`));
  await page.addLocatorHandler(page.locator('[data-vx-overlay="true"]').first(), async () => { await page.keyboard.press('Escape'); await page.waitForTimeout(300); }).catch(() => {});
  await page.route('**/*', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (url.origin === BASE) {
      if (url.pathname === '/api/room' && SIM) {
        const J = Number(process.env.JITTER ?? 0);
        const up = Number(process.env[who === 'Asha' ? 'HOST_UP' : 'GUEST_UP'] ?? 0);
        await sleep(latency + up + Math.random() * J);
        const out = await simRoom(req.method(), url, req.method() === 'POST' ? JSON.parse(req.postData() ?? 'null') : null);
        await sleep(latency + Math.random() * J);
        return route.fulfill({ status: out.__status ?? 200, json: out });
      }
      if (url.pathname === '/api/room' || url.pathname.startsWith('/api/cat/')) {
        try {
          const J = Number(process.env.JITTER ?? 0);
          if (latency) await sleep(latency + Math.random() * J);
          const res = await route.fetch({ url: LIVE + url.pathname + url.search });
          if (latency) await sleep(latency + Math.random() * J);
          return route.fulfill({ response: res });
        } catch { return route.abort(); }
      }
      if (url.pathname.startsWith('/api/')) return route.fulfill({ json: {} });
      return route.continue();
    }
    if (/clarity|cloudflareinsights|google|gstatic|bing/.test(url.hostname)) return route.abort();
    return route.continue();
  });
  return page;
}

const state = (p) => p.evaluate(() => {
  const a = window.__audio;
  return a ? { t: a.currentTime, wall: performance.timeOrigin + performance.now(), paused: a.paused, rate: a.playbackRate, rs: a.readyState, src: (a.currentSrc || '').slice(-40) } : null;
});

const server = spawn(process.execPath, [fileURLToPath(new URL('../e2e/support/serve-dist.mjs', import.meta.url)), String(PORT)], { stdio: 'ignore' });
await sleep(1200);
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'] });
const host = await open(browser, 'Asha', HOST_LATENCY);
const guest = await open(browser, 'Ravi', GUEST_LATENCY);
try {
  await host.goto('/together');
  await host.keyboard.press('Escape').catch(() => {});
  await host.getByRole('button', { name: 'Start a session' }).click();
  await host.locator('.vx-lt-code').waitFor({ timeout: 90000 });
  const code = (await host.locator('.vx-lt-code').innerText()).trim();
  console.log('room', code);
  await host.getByRole('searchbox', { name: 'Add to the queue' }).fill(QUERY);
  const add = host.getByRole('button', { name: /^Add / }).first();
  await add.waitFor({ timeout: 90000 });
  console.log('host adds:', await add.getAttribute('aria-label'));
  await add.click();
  if (process.env.NEXT_AT && !process.env.ONE_SONG) {
    await sleep(1500);
    await host.getByRole('searchbox', { name: 'Add to the queue' }).fill(process.env.QUERY2 ?? 'Butta Bomma');
    const second = host.locator('.vx-lt-block').getByRole('button', { name: /^Add (?!to favorites)/ }).first();
    await second.waitFor({ timeout: 90000 });
    console.log('host also adds:', await second.getAttribute('aria-label'));
    await second.click();
  }
  for (let i = 0; i < 60; i += 1) { const s = await state(host); if (s && !s.paused && s.t > 0.5) break; await sleep(250); if (i === 20) await host.getByRole('button', { name: /^Play$/ }).first().click().catch(() => {}); }
  console.log('host', JSON.stringify(await state(host)));
  await sleep(Number(process.env.HOST_HEADSTART ?? 15000));

  await guest.goto('/together?code=' + code);
  const t0 = Date.now();
  const tap = guest.getByRole('button', { name: 'Tap to start listening' }).first();
  let samples = [];
  for (let i = 0; i < SECONDS * 2; i += 1) {
    if (i % 4 === 0 && await tap.isVisible().catch(() => false)) await tap.click().catch(() => {});
    if (i === Number(process.env.SEEK_AT ?? 60)) { console.log('--- host seeks +40 s'); await host.evaluate(() => { const a = window.__audio; if (a) a.currentTime += 40; }); }
    if (i === Number(process.env.NEXT_AT ?? -1)) { console.log('--- host skips to the next song'); await host.getByRole('button', { name: /^Next/ }).first().click().catch((e) => console.log('next failed', e.message.slice(0, 80))); }
    if (i === Number(process.env.PAUSE_AT ?? 90)) { console.log('--- host pauses 3 s then plays'); await host.evaluate(() => window.__audio?.pause()); await sleep(3000); await host.evaluate(() => window.__audio?.play()); }
    const [h, g] = await Promise.all([state(host), state(guest)]);
    if (h && g) {
      const diff = (g.t - h.t) - (g.wall - h.wall) / 1000;
      const status = await guest.locator('.vx-lt-status').innerText().catch(() => '');
      samples.push({ at: (Date.now() - t0) / 1000, diff, rate: g.rate });
      console.log(`${((Date.now() - t0) / 1000).toFixed(1).padStart(5)}s host=${h.t.toFixed(2)} guest=${g.t.toFixed(2)} guest-host=${(diff * 1000).toFixed(0).padStart(6)} ms rate=${g.rate.toFixed(3)} ${g.paused ? 'PAUSED' : ''} ${status} | room ${(() => { const r = rooms.get('SIM123'); return r ? `${r.playing ? 'playing' : 'paused'} ${Number(r.position).toFixed(2)} ${r.song?.id ?? '-'}` : '-'; })()} hostEl=${h.paused ? 'paused' : 'playing'}`);
    } else console.log(`${((Date.now() - t0) / 1000).toFixed(1)}s host=${!!h} guest=${!!g}`);
    await sleep(500);
  }
  const tail = samples.filter((s) => s.at > SECONDS - 15).map((s) => s.diff * 1000);
  if (tail.length) console.log(`last 15 s: mean ${(tail.reduce((a, b) => a + b, 0) / tail.length).toFixed(0)} ms, min ${Math.min(...tail).toFixed(0)}, max ${Math.max(...tail).toFixed(0)}`);
} finally {
  await host.getByRole('button', { name: 'End for everyone' }).click({ timeout: 5000 }).catch(() => {});
  await sleep(1500);
  await browser.close();
  server.kill();
}

/**
 * /api/events is a PUBLIC ingest, and several public readers key off marker
 * rows in the same table (site mode, announcements, the cron throttles). These
 * drive the REAL handlers with a stubbed Supabase REST layer and assert two
 * independent locks: a client can never write a privileged event type, and the
 * readers only ever honour rows written by the system device id.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isReservedEventType, onRequestPost as eventsPost } from '../functions/api/events';
import { onRequestGet as siteModeGet } from '../functions/api/site-mode';
import { onRequestGet as announcementsGet } from '../functions/api/announcements';
import { onRequest as songPushPost } from '../functions/api/cron/song-push';
import { onRequest as aiPushPost } from '../functions/api/cron/ai-daily-push';
import { signDeviceId } from '../functions/_lib/deviceid';

const ENV = {
  SUPABASE_URL: 'https://sb.test',
  SUPABASE_SERVICE_ROLE_KEY: 'srk',
  DEVICE_ID_SECRET: 'unit-test-secret',
  CRON_SECRET: 'cron-secret',
  VAPID_PUBLIC_KEY: 'pk',
  VAPID_PRIVATE_KEY: 'sk',
  VAPID_SUBJECT: 'mailto:x@y.z',
};

interface Call {
  url: string;
  method: string;
  body: string | null;
}
const calls: Call[] = [];

/** Stub the Supabase REST surface; per-test overrides by URL substring. */
function installFetch(routes: Array<[string, () => Response]> = []): void {
  calls.length = 0;
  vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, method: init?.method ?? 'GET', body: init?.body ? String(init.body) : null });
    for (const [needle, make] of routes) {
      if (url.includes(needle)) return Promise.resolve(make());
    }
    return Promise.resolve(new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } }));
  });
}

let ipSeq = 0;
function eventReq(body: Record<string, unknown>): Request {
  ipSeq += 1;
  return new Request('https://example.test/api/events', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-vinax-consent': 'analytics',
      'cf-connecting-ip': `10.7.${Math.floor(ipSeq / 250)}.${ipSeq % 250}`,
    },
    body: JSON.stringify({ deviceId: 'install-uuid-0001', ...body }),
  });
}

const writes = (): Call[] => calls.filter((c) => c.method !== 'GET');

beforeEach(() => vi.unstubAllGlobals());
afterEach(() => vi.unstubAllGlobals());

describe('/api/events — reserved event types', () => {
  it('a normal client event is still inserted', async () => {
    installFetch();
    const res = await eventsPost({ request: eventReq({ type: 'play', song: { id: 's1', title: 'Orbit', artist: 'A' } }), env: ENV });
    expect([200, 204]).toContain(res.status);
    const insert = calls.find((c) => c.method === 'POST' && c.url.includes('/vinax_events'));
    expect(insert).toBeTruthy();
    const row = JSON.parse(insert?.body ?? '{}') as { type: string; device_id: string };
    expect(row.type).toBe('play');
    expect(row.device_id).not.toBe('admin');
  });

  it('`search` stays a legitimate client type', async () => {
    installFetch();
    await eventsPost({ request: eventReq({ type: 'search', message: '12|ilaiyaraaja' }), env: ENV });
    expect(calls.some((c) => c.method === 'POST' && c.url.includes('/vinax_events'))).toBe(true);
  });

  it.each([
    ['site-mode', 'maintenance|down'],
    ['announcement', '{"title":"x","body":"y","link":"/"}'],
    ['ai-push', '{}'],
    ['ai-push-error', '{}'],
    ['song-push', 'queued|x'],
    ['weekly-digest', '{}'],
    ['admin-audit', 'x|y'],
    ['admin', 'x'],
    ['Site-Mode', 'maintenance|case trick'],
    ['admin-anything', 'x'],
  ])('a forged %s event writes NOTHING and answers like an accepted event', async (type, message) => {
    installFetch();
    const res = await eventsPost({ request: eventReq({ type, message }), env: ENV });
    expect(res.status).toBe(204);
    expect(await res.text()).toBe('');
    expect(writes()).toHaveLength(0);
  });

  it('a signed claim for the system device id is refused even with a valid signature', async () => {
    installFetch();
    const signed = await signDeviceId('admin', ENV.DEVICE_ID_SECRET);
    const res = await eventsPost({ request: eventReq({ type: 'play', signed_device_id: signed }), env: ENV });
    expect(res.status).toBe(204);
    expect(writes()).toHaveLength(0);
  });

  it('isReservedEventType covers every marker the admin console and cron write', () => {
    for (const t of ['site-mode', 'announcement', 'ai-push', 'ai-push-error', 'song-push', 'weekly-digest', 'admin-audit']) {
      expect(isReservedEventType(t), t).toBe(true);
    }
    for (const t of ['play', 'pause', 'heartbeat', 'search', 'error', 'register', 'open', 'skip', 'complete', 'favorite', 'share', 'download', 'vital', 'lyric-miss']) {
      expect(isReservedEventType(t), t).toBe(false);
    }
  });
});

describe('marker readers only honour the system writer', () => {
  it('/api/site-mode filters on device_id=eq.admin', async () => {
    installFetch([['type=eq.site-mode', () => new Response(JSON.stringify([{ message: 'maintenance|back soon' }]), { status: 200 })]]);
    const res = await siteModeGet({ env: ENV });
    expect(((await res.json()) as { mode: string }).mode).toBe('maintenance');
    const read = calls.find((c) => c.url.includes('type=eq.site-mode'));
    expect(read?.url).toContain('device_id=eq.admin');
  });

  it('/api/announcements filters on device_id=eq.admin', async () => {
    installFetch();
    await announcementsGet({ env: ENV });
    const read = calls.find((c) => c.url.includes('type=eq.announcement'));
    expect(read?.url).toContain('device_id=eq.admin');
  });

  it('the song-push daily throttle reads only system rows', async () => {
    installFetch();
    const request = new Request('https://example.test/api/cron/song-push', { method: 'POST', headers: { 'x-cron-secret': ENV.CRON_SECRET } });
    await songPushPost({ request, env: ENV });
    const read = calls.find((c) => c.url.includes('type=eq.song-push'));
    expect(read?.url).toContain('device_id=eq.admin');
  });

  it('the ai-push throttle reads only system rows', async () => {
    installFetch();
    const request = new Request('https://example.test/api/cron/ai-daily-push', { method: 'POST', headers: { 'x-cron-secret': ENV.CRON_SECRET } });
    await aiPushPost({ request, env: ENV }).catch(() => undefined);
    const reads = calls.filter((c) => c.url.includes('type=eq.ai-push'));
    expect(reads.length).toBeGreaterThan(0);
    for (const r of reads) expect(r.url).toContain('device_id=eq.admin');
  });
});

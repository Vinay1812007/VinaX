/**
 * Scheduled AI song notification. Picks a song from the music catalog, lets the
 * AI write a short blurb, and pushes it to every subscribed device.
 *
 * Protected by CRON_SECRET. Trigger it from a scheduler (see
 * .github/workflows/song-push.yml) — Cloudflare Pages has no native cron.
 */
import { sbInsert, sbSelect, sbUpdate, type SupabaseEnv } from '../../_lib/supabase';
import { pushConfigured, sendPush, type PushSubscriptionRecord, type VapidEnv } from '../../_lib/webpush';
import { chat, type AiEnv } from '../../_lib/ai';
import { safeEqual } from '../../_lib/safe-compare';

type Env = SupabaseEnv & VapidEnv & AiEnv & { CRON_SECRET?: string };

/** Concurrency-bounded parallel map (up to `limit` in flight). */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<Array<PromiseSettledResult<R>>> {
  const results: Array<PromiseSettledResult<R>> = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      try {
        results[i] = { status: 'fulfilled', value: await fn(items[i], i) };
      } catch (err) {
        results[i] = { status: 'rejected', reason: err };
      }
    }
  });
  await Promise.all(workers);
  return results;
}

interface SubRow {
  endpoint: string;
  p256dh: string;
  auth: string;
}

const SEEDS = ['romantic', 'party', 'workout', 'chill', 'melody', 'dance', 'retro', 'love', 'hits', 'mood', 'lofi', 'acoustic'];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}
function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'song'
  );
}
function json(o: unknown, status = 200): Response {
  return new Response(JSON.stringify(o), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

interface CronContext {
  request: Request;
  env: Env;
  waitUntil?: (p: Promise<unknown>) => void;
}

export const onRequest = async (context: CronContext): Promise<Response> => {
  const { request, env, waitUntil } = context;
  // Audit finding H-SRV-7: `?key=` in the URL leaked into Cloudflare's
  // request logs. Header-only from here on.
  // NOTE: workflows must send x-cron-secret header, not ?key= query param.
  const key = request.headers.get('x-cron-secret') ?? '';
  // Constant-time compare so response timing can't leak the cron secret
  // byte-by-byte (audit finding M11).
  if (!env.CRON_SECRET || !safeEqual(key, env.CRON_SECRET)) return json({ error: 'unauthorized' }, 401);
  if (!pushConfigured(env)) return json({ error: 'push_not_configured' }, 400);
  // Hard cap: one song push per day, no matter how often the cron fires.
  const lastPush = await sbSelect<{ created_at: string }>(
    env,
    'vinax_events',
    'type=eq.song-push&select=created_at&order=created_at.desc&limit=1',
  ).catch(() => []);
  if (lastPush[0] && Date.now() - new Date(lastPush[0].created_at).getTime() < 20 * 3_600_000) {
    return json({ ok: false, reason: 'throttled_daily' }, 200);
  }

  let song: { id?: string; name?: string; artist?: string; image?: string } | null = null;
  try {
    const seed = pick(SEEDS);
    const r = await fetch(`https://saavn.dev/api/search/songs?query=${encodeURIComponent(seed)}&limit=20`);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const j = (await r.json().catch(() => null)) as any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const results = ((j && j.data && j.data.results) || []) as any[];
    if (results.length) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const s = pick(results) as any;
      const imgs = s.image || [];
      const artist =
        (s.artists && s.artists.primary && s.artists.primary[0] && s.artists.primary[0].name) ||
        s.primaryArtists ||
        '';
      song = {
        id: s.id,
        name: s.name,
        artist,
        image: imgs.length ? imgs[imgs.length - 1].url : '/icons/icon-192.png',
      };
    }
  } catch {
    // fall through to no-song
  }
  if (!song || !song.id) return json({ ok: false, reason: 'no_song' }, 200);

  let blurb = `${song.name}${song.artist ? ' · ' + song.artist : ''}`;
  try {
    const res = await chat(
      env,
      [
        {
          role: 'system',
          content: 'Write one warm, inviting push-notification line (12 words max) that makes someone want to play the song. Plain text only — no quotes, no emojis.',
        },
        { role: 'user', content: `Song: ${song.name} by ${song.artist || 'unknown'}.` },
      ],
      { lane: 'fast', maxTokens: 40, temperature: 0.8 },
    );
    if (res.content) blurb = res.content.trim().replace(/^["']|["']$/g, '').slice(0, 120);
  } catch {
    // keep the template blurb
  }

  const link = `/song/${slugify(song.name || 'song')}-${song.id}`;
  const subs = await sbSelect<SubRow>(
    env,
    'vinax_push_subscriptions',
    'select=endpoint,p256dh,auth&active=eq.true&limit=5000',
  );

  // Write the throttle marker BEFORE any push goes out. The sequential
  // await-loop this replaces could exhaust the 30 s Pages Functions budget
  // partway through and be killed with no marker written, so the next cron
  // fire would re-send to already-delivered users (audit finding H13). By
  // marking first, an interrupted run cannot double-push. The announcement
  // row and per-subscriber fan-out run inside waitUntil so the caller (the
  // scheduler) gets a fast ack.
  const throttleRow = sbInsert(env, 'vinax_events', {
    device_id: 'admin',
    type: 'song-push',
    message: `queued|${(song.name ?? '').slice(0, 200)}`,
  }).catch(() => false);
  const announcementRow = sbInsert(env, 'vinax_events', {
    device_id: 'admin',
    type: 'announcement',
    message: JSON.stringify({ title: 'Your song pick', body: blurb, link, ts: Date.now() }).slice(0, 900),
  }).catch(() => false);
  await Promise.all([throttleRow, announcementRow]);

  // Fan out in parallel with a bounded concurrency — the previous sequential
  // loop could not complete before the platform's wall-clock cutoff for
  // typical subscriber counts.
  const fanOut = async (): Promise<number> => {
    const results = await mapWithConcurrency(subs, 32, async (s) => {
      const res = await sendPush(env, s as PushSubscriptionRecord, {
        title: '🎵 Your song pick',
        body: blurb,
        url: link,
        icon: song.image,
      });
      if (res.gone) {
        await sbUpdate(env, 'vinax_push_subscriptions', `endpoint=eq.${encodeURIComponent(s.endpoint)}`, {
          active: false,
        }).catch(() => false);
      }
      return res.ok;
    });
    return results.reduce((n, r) => n + (r.status === 'fulfilled' && r.value ? 1 : 0), 0);
  };

  if (typeof waitUntil === 'function') {
    waitUntil(fanOut());
    return json({ ok: true, song: song.name, total: subs.length, sent: 'dispatched' }, 200);
  }
  const sent = await fanOut();
  return json({ ok: true, song: song.name, total: subs.length, sent }, 200);
};

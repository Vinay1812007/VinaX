/**
 * Scheduled AI song notification — PERSONALIZED PER LANGUAGE (4.16.0).
 *
 * The old version picked ONE song and sent the SAME message to every device.
 * Now subscribers are grouped by their language (device-declared locale
 * first, geography-inferred second — same cohort logic as ai-daily-push),
 * and each group gets its OWN song from its OWN catalog plus an AI blurb
 * WRITTEN IN THAT LANGUAGE. A Telugu listener gets a Telugu song announced
 * in Telugu; an English listener gets an English one.
 *
 * Protected by CRON_SECRET. Trigger it from a scheduler (see
 * .github/workflows/song-push.yml) — Cloudflare Pages has no native cron.
 */
import { sbInsert, sbSelect, sbUpdate, type SupabaseEnv } from '../../_lib/supabase';
import { pushConfigured, sendPush, type PushSubscriptionRecord, type VapidEnv } from '../../_lib/webpush';
import { gateRecipients, stampPushed, type GateEnv } from '../../_lib/notifyGate';
import { chat, type AiEnv } from '../../_lib/ai';
import { safeEqual } from '../../_lib/safe-compare';
import { catalogLang, groupByLang, langName } from '../../_lib/pushlang';

type Env = SupabaseEnv & VapidEnv & AiEnv & GateEnv & { CRON_SECRET?: string };

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
  country: string | null;
  region: string | null;
  city: string | null;
  lang: string | null;
  tz_offset: number | null;
  last_pushed_at: string | null;
}

interface Pick {
  id: string;
  name: string;
  artist: string;
  image: string;
}

const SEEDS = ['romantic', 'party', 'workout', 'chill', 'melody', 'dance', 'retro', 'love', 'hits', 'mood', 'lofi', 'acoustic'];
// AI-blurb groups per run — every group still gets its own SONG; groups past
// the cap fall back to the "song · artist" template instead of an AI line.
const MAX_AI_GROUPS = 8;
const MIRRORS = ['https://www.sirimillavinay.online/api/cat', 'https://saavn.sumit.co/api', 'https://nepotuneapi.vercel.app/api'];

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

/** One song from the group's own catalog (language-seeded search). */
async function pickSongForLang(lang: string): Promise<Pick | null> {
  const seed = `${catalogLang(lang)} ${pick(SEEDS)} songs`;
  for (const base of MIRRORS) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 6000);
      const r = await fetch(`${base}/search/songs?query=${encodeURIComponent(seed)}&limit=20`, {
        headers: { accept: 'application/json' },
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      if (!r.ok) continue;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const j = (await r.json().catch(() => null)) as any;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const results = ((j && j.data && j.data.results) || []) as any[];
      if (!results.length) continue;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const s = pick(results) as any;
      if (!s?.id || !s?.name) continue;
      const imgs = s.image || [];
      const artist =
        (s.artists && s.artists.primary && s.artists.primary[0] && s.artists.primary[0].name) ||
        s.primaryArtists ||
        '';
      return {
        id: String(s.id),
        name: String(s.name),
        artist: String(artist || ''),
        image: imgs.length ? imgs[imgs.length - 1].url : '/icons/icon-192.png',
      };
    } catch {
      /* dead mirror — try the next */
    }
  }
  return null;
}

/** AI blurb in the group's language; template fallback on any failure. */
async function blurbFor(env: Env, song: Pick, lang: string, allowAi: boolean): Promise<string> {
  const fallback = `${song.name}${song.artist ? ' · ' + song.artist : ''}`;
  if (!allowAi) return fallback;
  try {
    const language = langName(lang);
    const res = await chat(
      env,
      [
        {
          role: 'system',
          content: `Write one warm, inviting push-notification line (12 words max) that makes someone want to play the song. Write it in ${language}${language === 'English' ? '' : ' (native script)'}. Plain text only — no quotes, no emojis, no translation notes.`,
        },
        { role: 'user', content: `Song: ${song.name} by ${song.artist || 'unknown'}.` },
      ],
      { lane: 'fast', maxTokens: 60, temperature: 0.8 },
    );
    if (res.content) return res.content.trim().replace(/^["']|["']$/g, '').slice(0, 120);
  } catch {
    /* keep the template blurb */
  }
  return fallback;
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
  const key = request.headers.get('x-cron-secret') ?? '';
  // Constant-time compare so response timing can't leak the cron secret (M11).
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

  const allSubs = await sbSelect<SubRow>(
    env,
    'vinax_push_subscriptions',
    'select=endpoint,p256dh,auth,country,region,city,lang,tz_offset,last_pushed_at&active=eq.true&limit=5000',
  );
  if (!allSubs.length) return json({ ok: false, reason: 'no_subscribers' }, 200);

  // Eligibility gate (engine step 5 + 7): drop devices in their local quiet
  // hours (11pm–8am) or pushed within the frequency-cap window. Sends go only
  // to `subs`; the skip counts surface in the response for the notify log.
  const now = Date.now();
  const gate = gateRecipients(allSubs, env, now);
  const subs = gate.eligible;
  if (!subs.length) return json({ ok: false, reason: 'all_gated', skipped: { quiet: gate.skippedQuiet, fatigue: gate.skippedFatigue }, candidates: allSubs.length }, 200);

  // Group by language and prepare one song + one blurb per group. Every group
  // gets its own song; the AI-written line is capped at MAX_AI_GROUPS (the
  // long tail keeps the honest "song · artist" template).
  const groups = groupByLang(subs);
  const prepared: Array<{ lang: string; rows: SubRow[]; song: Pick; blurb: string; link: string }> = [];
  for (let i = 0; i < groups.length; i++) {
    const g = groups[i];
    const song = await pickSongForLang(g.lang);
    if (!song) continue;
    const blurb = await blurbFor(env, song, g.lang, i < MAX_AI_GROUPS);
    prepared.push({ lang: g.lang, rows: g.rows, song, blurb, link: `/song/${slugify(song.name)}-${song.id}` });
  }
  if (!prepared.length) return json({ ok: false, reason: 'no_song' }, 200);

  // Write the throttle marker BEFORE any push goes out (audit finding H13:
  // an interrupted run must never double-push on the next fire). The in-app
  // announcement uses the largest group's pick.
  const head = prepared[0];
  const throttleRow = sbInsert(env, 'vinax_events', {
    device_id: 'admin',
    type: 'song-push',
    message: `queued|${prepared.map((p) => `${p.lang}:${p.song.name}`).join('|').slice(0, 190)}`,
  }).catch(() => false);
  const announcementRow = sbInsert(env, 'vinax_events', {
    device_id: 'admin',
    type: 'announcement',
    message: JSON.stringify({ title: 'Your song pick', body: head.blurb, link: head.link, ts: Date.now() }).slice(0, 900),
  }).catch(() => false);
  await Promise.all([throttleRow, announcementRow]);

  // Fan out per group in parallel with bounded concurrency (audit L4/H13
  // lineage: the sequential loop could not finish inside the wall clock).
  const fanOut = async (): Promise<number> => {
    const jobs = prepared.flatMap((p) => p.rows.map((row) => ({ row, p })));
    const pushed: string[] = [];
    const results = await mapWithConcurrency(jobs, 32, async ({ row, p }) => {
      const res = await sendPush(env, row as PushSubscriptionRecord, {
        title: '🎵 Your song pick',
        body: p.blurb,
        url: p.link,
        icon: p.song.image,
      });
      if (res.gone) {
        await sbUpdate(env, 'vinax_push_subscriptions', `endpoint=eq.${encodeURIComponent(row.endpoint)}`, {
          active: false,
        }).catch(() => false);
      } else if (res.ok) {
        pushed.push(row.endpoint);
      }
      return res.ok;
    });
    // Stamp the frequency-cap clock for everyone actually delivered.
    if (pushed.length) await stampPushed(env, 'vinax_push_subscriptions', 'endpoint', pushed, new Date(now).toISOString());
    return results.reduce((n, r) => n + (r.status === 'fulfilled' && r.value ? 1 : 0), 0);
  };

  const summary = prepared.map((p) => ({ lang: p.lang, subscribers: p.rows.length, song: p.song.name }));
  const skipped = { quiet: gate.skippedQuiet, fatigue: gate.skippedFatigue };
  if (typeof waitUntil === 'function') {
    waitUntil(fanOut());
    return json({ ok: true, groups: summary, total: subs.length, candidates: allSubs.length, skipped, sent: 'dispatched' }, 200);
  }
  const sent = await fanOut();
  return json({ ok: true, groups: summary, total: subs.length, candidates: allSubs.length, skipped, sent }, 200);
};

/**
 * Scheduled AI push composer. The scheduler fires this endpoint 3–5 times a
 * day; each fire:
 *
 *   1. Picks a "slot" based on the hour of day the fire arrives (morning
 *      boost / noon new-release / evening commute / late-night unwind).
 *   2. Picks a target city — the highest-subscriber city that hasn't
 *      received an AI push today. Falls back to a region-wide push, then a
 *      country-wide push, then "everyone" if the geo picker can't find a
 *      fresh target.
 *   3. Asks the DJ lane (VINAX_CHATGPT_120_B, the creative engine) to pick
 *      a real song fitting the slot × city and write a warm 12-word push
 *      line. Structured JSON output — no free-form parsing.
 *   4. Resolves the AI's song pick against the jiosaavn catalog via the
 *      existing mirror-fallback (same helper the admin catalog-search
 *      endpoint uses).
 *   5. Sends the notification via web push + FCM, filtered to the target
 *      city / region / country.
 *   6. Writes an `ai-push` event row so the admin panel can show the log
 *      and the dedupe can find recently-targeted cities + songs.
 *
 * Protected by CRON_SECRET. Header-only (audit finding H-SRV-7).
 * Total wall clock: ~4 s per fire (AI turn is the long pole, ~2 s).
 */
import { dbInsert, dbSelect, dbUpdate, type DbEnv } from '../../_lib/db';
import { pushConfigured, sendPush, type PushSubscriptionRecord, type VapidEnv } from '../../_lib/webpush';
import { fcmConfigured, sendFcm, type FcmEnv } from '../../_lib/fcm';
import { chat, type AiEnv } from '../../_lib/ai';
import { safeEqual } from '../../_lib/safe-compare';
import { gateRecipients, stampPushed, type GateEnv } from '../../_lib/notifyGate';

type Env = DbEnv & VapidEnv & FcmEnv & AiEnv & GateEnv & { CRON_SECRET?: string };

function json(o: unknown, status = 200): Response {
  return new Response(JSON.stringify(o), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

/** Concurrency-bounded parallel map. Duplicated from song-push.ts to avoid
 *  an inter-directory helper import that Pages Functions rejects. */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<Array<PromiseSettledResult<R>>> {
  const results: Array<PromiseSettledResult<R>> = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      try {
        results[i] = { status: 'fulfilled', value: await fn(items[i]) };
      } catch (err) {
        results[i] = { status: 'rejected', reason: err };
      }
    }
  });
  await Promise.all(workers);
  return results;
}

// ============================================================================
// Slot picker — the hour of day (IST) decides which "vibe" to send.
// ============================================================================

interface Slot {
  key: string;
  label: string;
  vibe: string;
  emoji: string;
  seedQueries: string[];
}

const SLOTS: Slot[] = [
  { key: 'morning',    label: 'Morning boost',            vibe: 'upbeat morning energy — coffee, sunrise, get-out-of-bed',          emoji: '☀️',  seedQueries: ['morning hits', 'workout', 'happy vibes', 'good morning'] },
  { key: 'afternoon',  label: 'Afternoon new release',    vibe: 'fresh 2026 drop, released this week, one everyone will talk about', emoji: '✨',  seedQueries: ['new release', 'latest hits', 'trending today', 'fresh drop'] },
  { key: 'pickmeup',   label: 'Afternoon pick-me-up',     vibe: 'workday energy dip — snap out of it, mid-tempo, memorable, sing-along', emoji: '⚡',  seedQueries: ['upbeat', 'dance hits', 'party', 'sing along'] },
  { key: 'evening',    label: 'Evening unwind',           vibe: 'end-of-day mood — soften the room, romantic or reflective',        emoji: '🌆',  seedQueries: ['evening', 'romantic', 'melody', 'acoustic'] },
  { key: 'midnight',   label: 'Midnight quiet',           vibe: 'the last song before sleep — very quiet, slow, sparse',            emoji: '🌙',  seedQueries: ['sleep', 'lofi', 'quiet', 'ambient', 'piano', 'slow'] },
  { key: 'trending',   label: 'Trending here',            vibe: 'right-now trending for the target city',                           emoji: '🔥',  seedQueries: ['trending', 'viral hits', 'top songs'] },
];

/** Which slot does the current UTC hour map to? IST = UTC+5:30. Windowed
 *  loosely so a cron that fires a few minutes early/late still lands in the
 *  right slot. Owner-picked fire times are 08:00 · 13:00 · 16:00 · 21:00 ·
 *  00:00 IST — each window brackets one of those. */
function pickSlotForHour(utcHour: number, override?: string): Slot {
  if (override) {
    const found = SLOTS.find((s) => s.key === override);
    if (found) return found;
  }
  const ist = (utcHour + 5.5) % 24;
  if (ist >= 6  && ist < 11) return SLOTS[0];  // morning     — 08:00 IST fire
  if (ist >= 11 && ist < 14.5) return SLOTS[1]; // afternoon  — 13:00 IST fire
  if (ist >= 14.5 && ist < 19) return SLOTS[2]; // pickmeup   — 16:00 IST fire
  if (ist >= 19 && ist < 22.5) return SLOTS[3]; // evening    — 21:00 IST fire
  return SLOTS[4];                              // midnight   — 00:00 IST fire (or any 22:30–06:00 IST fallback)
}

// ============================================================================
// City / region picker — largest audience that hasn't been targeted today.
// ============================================================================

interface GeoTarget {
  scope: 'city' | 'region' | 'country' | 'everyone';
  country: string | null;
  region: string | null;
  city: string | null;
  reach: number;
}

interface SubGeoRow {
  country: string | null;
  region: string | null;
  city: string | null;
  lang: string | null;
}

// ============================================================================
// Language inference — device-declared lang first, geography-inferred second.
// ============================================================================

/** Map a full IETF locale ("hi-IN", "te", "en-US") to a coarse ISO-639-1
 *  two-letter primary code. Anything unknown falls back to English. */
function primaryLang(locale: string | null): string {
  if (!locale) return 'en';
  const two = locale.toLowerCase().split(/[-_]/)[0];
  return two && two.length === 2 ? two : 'en';
}

/** Geographic language inference for cities/regions where the device's
 *  declared `lang` is null. Only used as a fallback — the device's own
 *  browser locale wins whenever it exists. Coarse, region-anchored, and
 *  intentionally conservative (returns 'en' when nothing matches). */
function inferLangForGeo(city: string | null, region: string | null, country: string | null): string {
  const bag = `${city ?? ''} ${region ?? ''} ${country ?? ''}`.toLowerCase();
  if (/telangana|andhra|hyderabad|warangal|vijayawada|visakhapatnam|guntur|nellore|karimnagar/.test(bag)) return 'te';
  if (/tamil|chennai|madurai|coimbatore|salem|puducherry|tiruchi/.test(bag)) return 'ta';
  if (/karnataka|bengaluru|bangalore|mysore|hubli|mangalore/.test(bag)) return 'kn';
  if (/kerala|kochi|thiruvananthapuram|kozhikode|calicut|malappuram/.test(bag)) return 'ml';
  if (/maharashtra|goa|mumbai|bombay|pune|nagpur|nashik/.test(bag)) return 'mr';
  if (/west bengal|kolkata|calcutta|howrah|tripura|siliguri/.test(bag)) return 'bn';
  if (/gujarat|ahmedabad|surat|vadodara|rajkot/.test(bag)) return 'gu';
  if (/punjab|chandigarh|amritsar|ludhiana|jalandhar/.test(bag)) return 'pa';
  if (/bihar|jharkhand|patna|ranchi|dhanbad/.test(bag)) return 'bh';
  if (/kashmir|jammu|srinagar/.test(bag)) return 'ur';
  if (/odisha|orissa|bhubaneswar|cuttack/.test(bag)) return 'or';
  if (/assam|guwahati|shillong/.test(bag)) return 'as';
  if (/india|delhi|noida|gurgaon|lucknow|jaipur|kanpur|indore|bhopal/.test(bag)) return 'hi';
  return 'en';
}

/** Human-readable name for a language code — the AI prompt uses this so
 *  the model doesn't have to remember what "te" or "kn" means. */
const LANG_NAMES: Record<string, string> = {
  te: 'Telugu', ta: 'Tamil', kn: 'Kannada', ml: 'Malayalam', mr: 'Marathi',
  bn: 'Bengali', gu: 'Gujarati', pa: 'Punjabi', bh: 'Bhojpuri', ur: 'Urdu',
  or: 'Odia', as: 'Assamese', hi: 'Hindi', en: 'English',
};
function langName(code: string): string {
  return LANG_NAMES[code] ?? code;
}

async function pickTarget(env: Env): Promise<GeoTarget> {
  // Which cities already got an AI push today? (last 22h to be safe of clock skew.)
  const since = new Date(Date.now() - 22 * 3_600_000).toISOString();
  const recent = await dbSelect<{ message: string | null }>(
    env,
    'vinax_events',
    `type=eq.ai-push&created_at=gte.${encodeURIComponent(since)}&select=message&limit=200`,
  ).catch(() => []);
  const usedKeys = new Set<string>();
  for (const r of recent) {
    try {
      const m = JSON.parse(r.message ?? '{}') as { target?: { city?: string; region?: string; country?: string } };
      const t = m.target ?? {};
      usedKeys.add(`c:${(t.city ?? '').toLowerCase()}`);
      usedKeys.add(`r:${(t.region ?? '').toLowerCase()}`);
    } catch {
      /* ignore */
    }
  }

  const [webSubs, fcmToks] = await Promise.all([
    dbSelect<SubGeoRow>(env, 'vinax_push_subscriptions', 'select=country,region,city,lang&active=eq.true&limit=5000').catch(() => []),
    dbSelect<SubGeoRow>(env, 'vinax_fcm_tokens', 'select=country,region,city,lang&active=eq.true&limit=5000').catch(() => []),
  ]);
  const all = [...webSubs, ...fcmToks];

  // Rank cities by reach, filter out used-today, need at least 3 devices.
  const cityMap = new Map<string, { count: number; row: SubGeoRow }>();
  for (const row of all) {
    if (!row.city) continue;
    const key = `${row.country ?? ''}|${row.region ?? ''}|${row.city}`;
    const cur = cityMap.get(key) ?? { count: 0, row };
    cur.count += 1;
    cityMap.set(key, cur);
  }
  const cityCandidates = [...cityMap.entries()]
    .map(([k, v]) => ({ key: k, count: v.count, row: v.row }))
    .filter((c) => c.count >= 3 && !usedKeys.has(`c:${(c.row.city ?? '').toLowerCase()}`))
    .sort((a, b) => b.count - a.count);
  if (cityCandidates.length) {
    const c = cityCandidates[0];
    return { scope: 'city', country: c.row.country, region: c.row.region, city: c.row.city, reach: c.count };
  }

  // Region fallback.
  const regionMap = new Map<string, { count: number; row: SubGeoRow }>();
  for (const row of all) {
    if (!row.region) continue;
    const key = `${row.country ?? ''}|${row.region}`;
    const cur = regionMap.get(key) ?? { count: 0, row };
    cur.count += 1;
    regionMap.set(key, cur);
  }
  const regionCandidates = [...regionMap.entries()]
    .map(([k, v]) => ({ key: k, count: v.count, row: v.row }))
    .filter((c) => c.count >= 5 && !usedKeys.has(`r:${(c.row.region ?? '').toLowerCase()}`))
    .sort((a, b) => b.count - a.count);
  if (regionCandidates.length) {
    const c = regionCandidates[0];
    return { scope: 'region', country: c.row.country, region: c.row.region, city: null, reach: c.count };
  }

  // Country fallback.
  const countryMap = new Map<string, number>();
  for (const row of all) {
    if (!row.country) continue;
    countryMap.set(row.country, (countryMap.get(row.country) ?? 0) + 1);
  }
  const countryCandidates = [...countryMap.entries()].filter(([, n]) => n >= 5).sort((a, b) => b[1] - a[1]);
  if (countryCandidates.length) {
    return { scope: 'country', country: countryCandidates[0][0], region: null, city: null, reach: countryCandidates[0][1] };
  }

  // Everyone fallback.
  return { scope: 'everyone', country: null, region: null, city: null, reach: all.length };
}

// ============================================================================
// AI turn — asks the DJ lane for song pick + push copy in structured JSON.
// ============================================================================

interface AiPickResult {
  song_query: string;   // free-text query the catalog search can resolve
  title: string;        // <= 55 chars
  body: string;         // <= 120 chars
  reason?: string;      // short why (kept for logging, not shown)
}

function parseAiJson(raw: string): AiPickResult | null {
  // The model wraps its answer in various ways. Try (in order):
  //   1. Strip markdown code fences (```json...``` or ```...```).
  //   2. Grab the largest {...} substring (some models add preamble/postamble).
  //   3. Repair trailing commas (LLMs love those).
  const stripped = raw
    .replace(/^\s*```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .trim();

  // Greedy match — captures the outermost {...} including nested braces.
  const m = stripped.match(/\{[\s\S]*\}/);
  if (!m) return null;
  let jsonStr = m[0];
  // Repair trailing commas before ] or }
  jsonStr = jsonStr.replace(/,(\s*[}\]])/g, '$1');
  // Repair curly quotes that some models emit
  jsonStr = jsonStr.replace(/[“”]/g, '"').replace(/[‘’]/g, "'");

  try {
    const j = JSON.parse(jsonStr) as Partial<AiPickResult>;
    if (typeof j.song_query !== 'string' || typeof j.title !== 'string' || typeof j.body !== 'string') return null;
    if (!j.song_query.trim() || !j.title.trim() || !j.body.trim()) return null;
    return {
      song_query: j.song_query.slice(0, 120),
      title: j.title.slice(0, 55),
      body: j.body.slice(0, 120),
      reason: typeof j.reason === 'string' ? j.reason.slice(0, 200) : undefined,
    };
  } catch {
    return null;
  }
}

/** Template fallback for when the AI turn fails (model down, malformed
 *  JSON, timeout). Uses the slot seed + the cohort language + the city as
 *  a plausible song_query, then writes deterministic copy. Keeps the daily
 *  push firing so the audit chain doesn't stall. */
function templateFallback(slot: Slot, target: GeoTarget, cohort: LangCohort): AiPickResult {
  const seed = slot.seedQueries[Math.floor(Math.random() * slot.seedQueries.length)];
  const langHint = cohort.primaryLang === 'en' ? '' : `${langName(cohort.primaryLang).toLowerCase()} `;
  const cityHint = target.city ?? target.region ?? '';
  const query = `${langHint}${seed}${cityHint ? ' ' + cityHint : ''}`.trim();
  const where = target.city ?? target.region ?? target.country ?? '';
  const wherePrefix = where ? `${where} — ` : '';
  return {
    song_query: query.slice(0, 120),
    title: (wherePrefix + slot.label).slice(0, 55),
    body: `A ${slot.vibe.split(' — ')[0]} pick in ${langName(cohort.primaryLang)}, on tap.`.slice(0, 120),
    reason: 'template_fallback',
  };
}

interface AiTurnResult {
  pick: AiPickResult | null;
  rawOutput: string | null;
  laneError: string | null;
}

/** Preferred audio language for this cohort. May differ from the geo
 *  inference (a device declared its own browser locale). */
interface LangCohort {
  primaryLang: string;    // ISO-639-1 two-letter (te/ta/hi/en/...)
  count: number;          // devices in this cohort
  matchStyle: 'declared' | 'geo-inferred'; // which signal we used
}

async function aiPickAndCompose(env: Env, slot: Slot, target: GeoTarget, cohort: LangCohort): Promise<AiTurnResult> {
  const targetLabel = target.scope === 'city' ? `${target.city}, ${target.region ?? ''} (${target.country ?? ''})`
    : target.scope === 'region' ? `${target.region} (${target.country ?? ''})`
    : target.scope === 'country' ? target.country ?? 'India'
    : 'everyone globally';
  const langLabel = langName(cohort.primaryLang);

  // Seed the model with real trending titles IN THE COHORT'S LANGUAGE so it
  // doesn't hallucinate. The seed query blends the slot vibe + language.
  const rawSeed = slot.seedQueries[Math.floor(Math.random() * slot.seedQueries.length)];
  const langHintQuery = cohort.primaryLang === 'en'
    ? rawSeed
    : `${langLabel.toLowerCase()} ${rawSeed}`;
  let trendingHint = '';
  try {
    const r = await fetch(`https://saavn.dev/api/search/songs?query=${encodeURIComponent(langHintQuery)}&limit=8`, { signal: AbortSignal.timeout(4000) });
    if (r.ok) {
      const j = (await r.json()) as { data?: { results?: Array<{ name?: string; artists?: { primary?: Array<{ name?: string }> } }> } };
      const list = j.data?.results ?? [];
      trendingHint = list
        .slice(0, 5)
        .map((s) => `${s.name ?? ''} — ${s.artists?.primary?.[0]?.name ?? ''}`)
        .filter(Boolean)
        .join(' · ');
    }
  } catch {
    /* trending hint is a nice-to-have */
  }

  const sys = `You compose ONE push notification for the music app VinaX. Output ONLY a JSON object — no preamble, no code fences, no explanation. Schema:
{"song_query":"<song name and main artist>","title":"<max 55 chars>","body":"<max 120 chars>","reason":"<why it fits, max 200 chars>"}

Rules:
- Pick a REAL song in jiosaavn's catalog. The song's AUDIO LANGUAGE MUST match the target listener's language cohort.
- song_query = clean search text: song name + main artist. No punctuation like quotes or hashtags.
- title: a short hook. Use the city name if provided. English words are fine even for non-English audio songs — the app UI is multilingual, notifications read fine in English. Avoid emoji unless the vibe demands one.
- body: ONE reason to open. Warm and human. Not marketing.
- Never say "VinaX", "our", "listen now", "check out". No quotes around field values.`;

  const usr = `SLOT: ${slot.label} (${slot.vibe})
TARGET CITY / REGION: ${targetLabel}
AUDIO LANGUAGE (mandatory — the song MUST be in this language): ${langLabel} (${cohort.primaryLang})
Signal used: ${cohort.matchStyle === 'declared' ? 'these listeners set their browser to this language' : 'inferred from the region'}

Real trending seed matches for "${langHintQuery}":
${trendingHint || '(seed empty — pick a well-known song fitting the vibe in ' + langLabel + ')'}

Reply with JSON only. The song_query must resolve to a ${langLabel} song.`;

  let rawOutput: string | null = null;
  let laneError: string | null = null;
  try {
    const res = await chat(
      env,
      [{ role: 'system', content: sys }, { role: 'user', content: usr }],
      { lane: 'dj', maxTokens: 260, temperature: 0.85 },
    );
    rawOutput = res.content ?? null;
    if (!rawOutput) return { pick: null, rawOutput: null, laneError: 'empty_response' };
    const parsed = parseAiJson(rawOutput);
    if (parsed) return { pick: parsed, rawOutput, laneError: null };
    // Second try — fall back to the fast lane with a very narrow prompt.
    // Some models (esp. the big DJ engine) occasionally add preamble even
    // when instructed not to; the fast lane tends to obey terser prompts.
    try {
      const res2 = await chat(
        env,
        [
          { role: 'system', content: 'Return ONLY a JSON object matching {"song_query":"...","title":"...","body":"..."}. No prose. No code fences.' },
          { role: 'user', content: `Pick a "${slot.vibe}" song in ${langLabel} for ${targetLabel}. Return the JSON.` },
        ],
        { lane: 'fast', maxTokens: 200, temperature: 0.7 },
      );
      if (res2.content) {
        rawOutput = (rawOutput ?? '') + '\n---retry---\n' + res2.content;
        const parsed2 = parseAiJson(res2.content);
        if (parsed2) return { pick: parsed2, rawOutput, laneError: 'dj_unparseable_fast_ok' };
      }
    } catch (e2) {
      laneError = 'fast_lane_' + ((e2 as Error).message ?? 'unknown');
    }
    return { pick: null, rawOutput, laneError: laneError ?? 'unparseable_both_lanes' };
  } catch (e) {
    return { pick: null, rawOutput, laneError: 'dj_lane_' + ((e as Error).message ?? 'unknown') };
  }
}

// ============================================================================
// Catalog resolution — mirror fallback (same pool the admin proxy uses).
// ============================================================================

// 5.0.0 sweep: self-hosted catalog first; dead mirrors (saavn.dev DNS gone,
// b4a.run 404s these routes) dropped so resolution stops burning a timeout
// per dead base before reaching the one that answers.
const CATALOG_MIRRORS = [
  'https://www.sirimillavinay.online/api/cat',
  'https://saavn.sumit.co/api',
  'https://nepotuneapi.vercel.app/api',
];

interface CatalogHit {
  id: string;
  name: string;
  artist: string;
  image: string;
}

async function resolveSong(query: string): Promise<CatalogHit | null> {
  const path = `/search/songs?query=${encodeURIComponent(query)}&limit=3`;
  for (const base of CATALOG_MIRRORS) {
    try {
      const r = await fetch(base + path, { signal: AbortSignal.timeout(5000) });
      if (!r.ok) continue;
      const j = (await r.json()) as { data?: { results?: unknown[] }; results?: unknown[] };
      const list = (j?.data?.results ?? j?.results ?? []) as Array<{
        id?: string; name?: string; artists?: { primary?: Array<{ name?: string }> };
        primaryArtists?: string; image?: unknown;
      }>;
      const first = list[0];
      if (!first?.id || !first?.name) continue;
      const artist = first.artists?.primary?.[0]?.name ?? first.primaryArtists ?? '';
      const imgs = Array.isArray(first.image) ? first.image : [];
      const img = imgs.length ? ((imgs[imgs.length - 1] as { url?: string; link?: string })?.url ?? '') : '';
      return { id: String(first.id), name: String(first.name), artist: String(artist), image: img || '/icons/icon-192.png' };
    } catch {
      /* try next mirror */
    }
  }
  return null;
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'song';
}

// ============================================================================
// Main handler.
// ============================================================================

interface CronContext {
  request: Request;
  env: Env;
  waitUntil?: (p: Promise<unknown>) => void;
}

export const onRequest = async (context: CronContext): Promise<Response> => {
  const { request, env, waitUntil } = context;
  const key = request.headers.get('x-cron-secret') ?? '';
  if (!env.CRON_SECRET || !safeEqual(key, env.CRON_SECRET)) return json({ error: 'unauthorized' }, 401);
  if (!pushConfigured(env) && !fcmConfigured(env)) return json({ error: 'push_not_configured' }, 400);

  // Throttle: at most one AI push per 2h30m. Owner-picked schedule has two
  // tight 3-hour gaps (13:00→16:00 IST and 21:00→00:00 IST); a stricter
  // 3-hour floor would block the second slot if the scheduler ran a few
  // minutes late. 2h30m gives enough headroom to absorb normal GitHub
  // Actions queue jitter while still preventing scheduler-loop abuse.
  const url = new URL(request.url);
  const force = url.searchParams.get('force') === '1';
  if (!force) {
    const throttleFloor = new Date(Date.now() - 150 * 60_000).toISOString();
    const recent = await dbSelect<{ created_at: string }>(
      env,
      'vinax_events',
      `type=eq.ai-push&created_at=gte.${encodeURIComponent(throttleFloor)}&select=created_at&limit=1`,
    ).catch(() => []);
    if (recent.length) return json({ ok: false, reason: 'throttled_150min', hint: 'workflow_dispatch → force:true to bypass' }, 200);
  }

  // Slot pick — hour of day, or ?slot=morning etc for manual dispatch.
  const slotOverride = url.searchParams.get('slot') ?? undefined;
  const slot = pickSlotForHour(new Date().getUTCHours(), slotOverride ?? undefined);

  const target = await pickTarget(env);

  // ============================================================
  // Personalization: split the target into LANGUAGE COHORTS.
  // Each cohort gets its own AI-picked song in that language.
  // ============================================================
  const targetSubsFilter: string[] = [];
  if (target.country) targetSubsFilter.push(`country=eq.${encodeURIComponent(target.country)}`);
  if (target.region) targetSubsFilter.push(`region=eq.${encodeURIComponent(target.region)}`);
  if (target.city) targetSubsFilter.push(`city=eq.${encodeURIComponent(target.city)}`);
  const targetSuffix = targetSubsFilter.length ? '&' + targetSubsFilter.join('&') : '';

  const [webCohortRows, fcmCohortRows] = await Promise.all([
    dbSelect<{ lang: string | null }>(env, 'vinax_push_subscriptions', `select=lang&active=eq.true&limit=5000${targetSuffix}`).catch(() => []),
    dbSelect<{ lang: string | null }>(env, 'vinax_fcm_tokens', `select=lang&active=eq.true&limit=5000${targetSuffix}`).catch(() => []),
  ]);
  const cohortSource = [...webCohortRows, ...fcmCohortRows];
  const geoInferred = inferLangForGeo(target.city, target.region, target.country);

  const langBuckets = new Map<string, { count: number; declaredCount: number; inferredCount: number }>();
  for (const row of cohortSource) {
    let code: string;
    let matchStyle: 'declared' | 'geo-inferred';
    if (row.lang && row.lang.trim()) {
      code = primaryLang(row.lang);
      matchStyle = 'declared';
    } else {
      code = geoInferred;
      matchStyle = 'geo-inferred';
    }
    const cur = langBuckets.get(code) ?? { count: 0, declaredCount: 0, inferredCount: 0 };
    cur.count += 1;
    if (matchStyle === 'declared') cur.declaredCount += 1; else cur.inferredCount += 1;
    langBuckets.set(code, cur);
  }

  // Cohorts to actually push: need at least 2 devices in the cohort.
  // Cap total cohorts per fire at 3 so one slot doesn't blast 10 pushes.
  const MIN_COHORT_SIZE = 2;
  const MAX_COHORTS_PER_FIRE = 3;
  const cohorts: LangCohort[] = [...langBuckets.entries()]
    .filter(([, v]) => v.count >= MIN_COHORT_SIZE)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, MAX_COHORTS_PER_FIRE)
    .map(([code, v]) => ({
      primaryLang: code,
      count: v.count,
      matchStyle: v.declaredCount >= v.inferredCount ? 'declared' : 'geo-inferred',
    }));

  // If nothing hit the threshold (very small subscriber base), collapse into
  // one cohort using the geo-inferred language for everyone in the target.
  if (!cohorts.length && cohortSource.length > 0) {
    cohorts.push({ primaryLang: geoInferred, count: cohortSource.length, matchStyle: 'geo-inferred' });
  }
  if (!cohorts.length) {
    return json({ ok: false, reason: 'no_subscribers_in_target', slot: slot.key, target }, 200);
  }

  // ============================================================
  // Fire one push per cohort. Each cohort gets its own AI turn,
  // song resolution, audit row, and location+language filter.
  // ============================================================
  const cohortResults: Array<Record<string, unknown>> = [];
  const fanOutAll: Array<Promise<unknown>> = [];

  for (const cohort of cohorts) {
    const aiTurn = await aiPickAndCompose(env, slot, target, cohort);
    let pick = aiTurn.pick;
    let pickedBy: 'ai' | 'template' = 'ai';
    if (!pick) {
      pick = templateFallback(slot, target, cohort);
      pickedBy = 'template';
    }

    const song = await resolveSong(pick.song_query);
    if (!song) {
      await dbInsert(env, 'vinax_events', {
        device_id: 'admin', type: 'ai-push-error',
        message: JSON.stringify({ reason: 'song_not_in_catalog', slot: slot.key, target, cohort, pick, ai_raw: aiTurn.rawOutput, ai_error: aiTurn.laneError, ts: Date.now() }).slice(0, 900),
      }).catch(() => false);
      cohortResults.push({ cohort: cohort.primaryLang, ok: false, reason: 'song_not_in_catalog', ai_error: aiTurn.laneError, pick });
      continue;
    }

    const link = `/song/${slugify(song.name)}-${song.id}`;

    // Per-cohort filter: target geo + language filter. Language is matched
    // via ILIKE prefix so "hi" catches hi / hi-IN / hi-Latn etc. For
    // geo-inferred cohorts we ALSO include devices with null lang (they
    // didn't declare a locale, so we send them the region's default).
    // PostgREST OR syntax: `or=(lang.ilike.hi*,lang.is.null)`.
    const finalGeoFilter = targetSuffix.replace(/^&/, '');
    const langClause = cohort.matchStyle === 'geo-inferred'
      ? `or=(lang.ilike.${encodeURIComponent(cohort.primaryLang + '*')},lang.is.null)`
      : `lang=ilike.${encodeURIComponent(cohort.primaryLang + '%')}`;
    const cohortFullSuffix = finalGeoFilter ? `&${finalGeoFilter}&${langClause}` : `&${langClause}`;

    await dbInsert(env, 'vinax_events', {
      device_id: 'admin',
      type: 'ai-push',
      song_id: song.id,
      song_title: song.name,
      song_artist: song.artist,
      country: target.country,
      region: target.region,
      city: target.city,
      language: cohort.primaryLang,
      message: JSON.stringify({
        slot: slot.key,
        target: { scope: target.scope, city: target.city, region: target.region, country: target.country, reach: target.reach },
        cohort: { lang: cohort.primaryLang, langName: langName(cohort.primaryLang), count: cohort.count, matchStyle: cohort.matchStyle },
        title: pick.title,
        body: pick.body,
        reason: pick.reason,
        link,
        pickedBy,
        ai_error: aiTurn.laneError,
        ts: Date.now(),
      }).slice(0, 900),
    }).catch(() => false);

    // Fan-out for this cohort — same shape as before, just with the
    // additional lang filter. Kept synchronous within the loop so cohort
    // audit rows land in order; the actual push send is async via waitUntil.
    const fanOut = async (): Promise<{ web: number; gone: number; fcm: number; quiet: number; fatigue: number }> => {
      let web = 0; let gone = 0; let fcm = 0; let quiet = 0; let fatigue = 0;
      const nowMs = Date.now();
      const nowIso = new Date(nowMs).toISOString();
      if (pushConfigured(env)) {
        const allSubs = await dbSelect<{ endpoint: string; p256dh: string; auth: string; country: string | null; tz_offset: number | null; last_pushed_at: string | null }>(
          env, 'vinax_push_subscriptions',
          `select=endpoint,p256dh,auth,country,tz_offset,last_pushed_at&active=eq.true&limit=5000${cohortFullSuffix}`,
        ).catch(() => []);
        // Eligibility gate (engine step 5 + 7): skip quiet-hours + frequency-capped.
        const g = gateRecipients(allSubs, env, nowMs);
        quiet += g.skippedQuiet; fatigue += g.skippedFatigue;
        const pushed: string[] = [];
        const results = await mapWithConcurrency(g.eligible, 32, async (s) => {
          const r = await sendPush(env, s as PushSubscriptionRecord, { title: pick.title, body: pick.body, url: link, icon: song.image });
          if (r.gone) await dbUpdate(env, 'vinax_push_subscriptions', `endpoint=eq.${encodeURIComponent(s.endpoint)}`, { active: false }).catch(() => false);
          else if (r.ok) pushed.push(s.endpoint);
          return r;
        });
        for (const r of results) { if (r.status === 'fulfilled') { if (r.value.ok) web += 1; if (r.value.gone) gone += 1; } }
        if (pushed.length) await stampPushed(env, 'vinax_push_subscriptions', 'endpoint', pushed, nowIso);
      }
      if (fcmConfigured(env)) {
        const allToks = await dbSelect<{ token: string; country: string | null; tz_offset: number | null; last_pushed_at: string | null }>(
          env, 'vinax_fcm_tokens', `select=token,country,tz_offset,last_pushed_at&active=eq.true&limit=5000${cohortFullSuffix}`,
        ).catch(() => []);
        const g = gateRecipients(allToks, env, nowMs);
        quiet += g.skippedQuiet; fatigue += g.skippedFatigue;
        if (g.eligible.length) {
          const r = await sendFcm(env, g.eligible.map((t) => t.token), { title: pick.title, body: pick.body, link });
          fcm = r.sent;
          const dead = new Set(r.dead);
          const delivered = g.eligible.map((t) => t.token).filter((t) => !dead.has(t));
          if (delivered.length) await stampPushed(env, 'vinax_fcm_tokens', 'token', delivered, nowIso);
          await mapWithConcurrency(r.dead, 16, (d) =>
            dbUpdate(env, 'vinax_fcm_tokens', `token=eq.${encodeURIComponent(d)}`, { active: false }).catch(() => false),
          );
        }
      }
      return { web, gone, fcm, quiet, fatigue };
    };

    if (typeof waitUntil === 'function') {
      fanOutAll.push(fanOut());
      cohortResults.push({
        cohort: cohort.primaryLang, langName: langName(cohort.primaryLang), count: cohort.count, matchStyle: cohort.matchStyle,
        song: { id: song.id, name: song.name, artist: song.artist },
        copy: { title: pick.title, body: pick.body }, link, pickedBy, ai_error: aiTurn.laneError, dispatch: 'async',
      });
    } else {
      const counts = await fanOut();
      cohortResults.push({
        cohort: cohort.primaryLang, langName: langName(cohort.primaryLang), count: cohort.count, matchStyle: cohort.matchStyle,
        song: { id: song.id, name: song.name, artist: song.artist },
        copy: { title: pick.title, body: pick.body }, link, pickedBy, ai_error: aiTurn.laneError, ...counts,
      });
    }
  }

  if (typeof waitUntil === 'function' && fanOutAll.length) {
    waitUntil(Promise.allSettled(fanOutAll));
  }

  return json({ ok: true, slot: slot.key, target, cohorts: cohortResults, cohortsFired: cohortResults.length });
};

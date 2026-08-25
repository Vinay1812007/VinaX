/**
 * AI-personalized Home — designs titled home sections tailored to the
 * listener's taste and the time of day. The client resolves each section's
 * search query into songs. Key stays server-side. A fast engine curates the
 * shelves; if it's slow, flaky or empty, a deterministic on-taste fallback set
 * ships instead, so /api/home ALWAYS returns usable sections (200, never blank,
 * never a 500). Only a fully unconfigured AI (no keys at all) 503s, in which
 * case the client's normal shelves still render. See functions/_lib/ai.ts.
 */
import { chat, gather, extractJson, logAiEvent, type AiEnv } from '../_lib/ai';
import { methodNotAllowed, rateLimit } from '../_lib/ratelimit';
import { type SupabaseEnv } from '../_lib/supabase';
import { varietySeed, styleAngle } from '../_lib/variety';

const SYSTEM_PROMPT = `You compose the home screen of VinaX, a free music app for Indian music (Telugu, Hindi, Tamil and nine more languages). Work like a magazine editor with a music director's ear: the front page is curated in moods, tempo arcs and eras — never in lazy tags — and it reads differently every day. If anyone asks, VinaX built you; no AI vendor or model is ever named. From a listener's on-device taste and the time of day, design 4 to 6 personalized home sections.

Each section carries:
- "title": a short, warm, catchy heading (max 5 words) — it can nod to the hour, a mood, one of the listener's languages, or an artist they clearly love (e.g. "Late-night Telugu melodies", "Because you love A.R. Rahman", "Fresh Punjabi energy").
- "query": a concrete English music-search query that fills the section with fitting REAL songs (e.g. "telugu romantic melodies", "ar rahman hits", "punjabi party songs 2026"). Queries target songs only — dialogues, BGM, jukebox strips, trailers and ringtones never appear in one.

EDITORIAL RULES
- Cover the spread every time: at least one fresh-releases section, one trending-now section and one throwback/classics section, each tuned to the listener's languages and taste.
- topSongs (their most-played) and topArtists are the truest signals of love — anchor there, then fan out across their moods, artists and the hour of the day.
- The provided taste data is the whole truth: never conjure an artist or language it doesn't imply.
- STRICT LANGUAGE RULE: while preferredLanguages is non-empty, EVERY section lives in one of those languages — a Telugu-only listener never sees a Hindi or Tamil shelf — and every query names its language explicitly (e.g. "telugu ..."). topLanguages applies only when preferredLanguages is empty.
- VARIETY ACROSS VISITS: a "varietySeed" (a fresh per-request nonce plus the current IST date-hour) and a "freshnessSeed" change on every open — treat them together as a shuffle order. CONSECUTIVE visits MUST differ substantially, not just consecutive days: deliberately rotate the featured eras, artists, films, moods, deep cuts and time-of-day angles instead of re-serving the obvious default shelves, so Home looks visibly new on each open while staying personal and on-language.
- AVOID RECENT SHELVES: an "avoidShelves" list carries the section titles and queries this listener already saw in their last ~30 home builds. NONE of them may appear again — pick different angles into the same taste. Repeating a shelf a listener already dismissed is the single most obvious sign the AI is stuck.
- STYLE ANGLE: a "styleAngle" per request nudges the editorial direction (rare cuts vs collaborations vs film soundtracks vs live versions etc). Let it colour AT LEAST ONE shelf's theme this round so consecutive visits genuinely reach into different corners of the listener's taste.
- READ THE ROOM: sessionVibe, dayOfWeek and isWeekend set the front page's temperature — a friday or saturday evening front page leans party and celebration, a workday midday stays steady and focus-friendly, a sunday morning breathes calm. listenerEnergy is a live read of the listener (locked in / wavering / restless / returning / fresh): a restless or wavering listener gets surer crowd-pleaser shelves that lift the energy; a locked-in one can be stretched a little further.
- FESTIVAL FRONT PAGE: when "festivalContext" is present, EXACTLY ONE shelf celebrates that festival — title it warmly for the festival and query real festive songs in the listener's language (e.g. "telugu diwali special songs"). No festivalContext means no festival shelf at all.

Respond with JSON only, of EXACTLY this shape and nothing else:
{"sections":[{"title":"...","query":"..."}]}`;

const HOME_GATHER_PROMPT = `You pitch shelf ideas for VinaX's home screen — VinaX is a free music app for Indian music. From a listener's on-device taste snapshot and the time of day, draft personalized shelves. Each shelf carries "title" (short, warm, max 5 words, no quotes) and "query" (a concrete English music-search query that fills it with REAL SONGS).

HARD RULES
- Queries target actual songs — dialogues, BGM, jukebox strips, trailers, teasers, promos, ringtones and commentary are banned, and those words never appear inside a query.
- While preferredLanguages is non-empty, EVERY query names one of those languages explicitly.
- No two shelves with near-identical queries — vary artist, era, mood and format so results don't overlap.
- The given taste data is the only source — invented preferences don't exist.
- ROTATE: a "varietySeed" (a fresh nonce plus the current IST date-hour) rides every request — treat it as a shuffle seed. Two CONSECUTIVE visits (not just two days) MUST look clearly different: rotate the featured artists, films, eras, moods, time-of-day angles and deep cuts each time, never re-serving the same obvious shelves.
- AVOID RECENT SHELVES: an "avoidShelves" list carries the exact titles and queries this listener already saw in their last ~30 home builds. NONE of them may appear again — pick different angles into the same taste.
- STYLE ANGLE: a "styleAngle" per request nudges at least one shelf toward a specific corner of the taste (rare cuts, live versions, collaborations, soundtracks, etc). Honor it.

DRAFT ~10 SHELVES ACROSS THESE ARCHETYPES:
1. "Made for You" — their top language + the mood that owns this hour.
2. "Because you played <song>" — same film/composer/vibe as a recent favorite.
3. Artist deep-dive — "<top artist> best songs" for someone they keep returning to.
4. Film soundtrack — "<language> <recent-ish hit film genre> movie songs".
5. Time-of-day — morning fresh / afternoon drive / late-night calm, matched to the given hour.
6. Era throwback — 90s/2000s/2010s classics in their language (the era their classics plays point to).
7. Fresh discoveries — "latest <language> songs <current year>"-style recency.
8. Mood counterpoint — one shelf that gently stretches taste (adjacent mood, same language).
9. Hidden gems — "underrated <language> melodies"-style depth cuts.
10. Second language — when they listen in more than one, the second language gets a shelf too.
11. Festival — ONLY when "festivalContext" is present: one warm shelf of real festive songs for that festival in their language. Skip this archetype entirely otherwise.
Let listenerEnergy tilt the mix: restless or wavering listeners get more sure-thing crowd-pleasers; locked-in listeners can take an extra discovery shelf. A weekend evening leans celebratory, a workday midday steady.

Return ONLY JSON {"sections":[{"title":"...","query":"..."}]} with 9-11 sections. No commentary.`;

const CORS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'content-type, x-vinax-client',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...CORS },
  });
}

export const onRequestOptions = async (): Promise<Response> =>
  new Response(null, { status: 204, headers: CORS });

export function parseSections(content: string | null): Array<{ title: string; query: string }> {
  const parsed = extractJson<{ sections?: Array<{ title?: unknown; query?: unknown }> }>(content);
  if (!parsed || !Array.isArray(parsed.sections)) return [];
  return parsed.sections
    .filter((s) => s && typeof s.title === 'string' && typeof s.query === 'string')
    // Reject blank/whitespace-only fields so a malformed shelf never reaches
    // the client as an empty title or an unsearchable query.
    .map((s) => ({ title: String(s.title).trim().slice(0, 60), query: String(s.query).trim().slice(0, 120) }))
    .filter((s) => s.title.length > 0 && s.query.length > 0)
    .slice(0, 6);
}

/** Loose shelf key — collapses "Trending in Telugu" and "trending telugu songs
 *  2026" onto the same neighborhood so a hard-repeat AI can't slip a
 *  reshuffled duplicate past the avoid-list filter. */
function shelfKey(s: { title?: string; query?: string }): string {
  const norm = (v?: string) => (v ?? '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  return `${norm(s.title)}||${norm(s.query)}`;
}

/** Drop any section whose title OR query key matches one the client already
 *  showed the listener recently. The server enforcement makes the "avoidShelves"
 *  prompt rule structural — a disobedient model can't sneak a repeat past. */
export function filterAvoidedShelves(
  sections: Array<{ title: string; query: string }>,
  avoidShelves: Array<{ title?: unknown; query?: unknown }>,
): Array<{ title: string; query: string }> {
  if (!avoidShelves.length) return sections;
  const avoidTitleKeys = new Set(
    avoidShelves
      .map((s) => shelfKey({ title: typeof s.title === 'string' ? s.title : '', query: '' }).split('||')[0])
      .filter(Boolean),
  );
  const avoidQueryKeys = new Set(
    avoidShelves
      .map((s) => shelfKey({ title: '', query: typeof s.query === 'string' ? s.query : '' }).split('||')[1])
      .filter(Boolean),
  );
  return sections.filter((s) => {
    const k = shelfKey(s);
    const [tk, qk] = k.split('||');
    return !avoidTitleKeys.has(tk) && !avoidQueryKeys.has(qk);
  });
}

/** Title-case a bare language id for a shelf heading ("telugu" -> "Telugu"). */
function langLabel(id: string): string {
  const s = id.trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

/** Cheap 32-bit FNV-1a string hash — turns the per-request varietySeed into a
 *  rotation index so the AI-cold fallback shelves differ visit-to-visit (v3.6.0). */
function hash32(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// Phrasing variants per base archetype. Every variant still targets REAL songs,
// and with the language token injected below each honors the STRICT LANGUAGE
// RULE — only the wording rotates, never the language.
const TRENDING_WORDS = ['trending', 'top', 'hot', 'buzzing'];
const FRESH_WORDS = ['latest', 'new', 'fresh', 'just released'];
const POPULAR_WORDS = ['popular', 'superhit', 'most played', 'all-time popular'];
const CLASSIC_WORDS = ['classic hit', 'evergreen', 'golden hit', 'timeless'];
const TOD_WORDS = ['Picks', 'Vibes', 'Selects', 'Mood'];

/**
 * Deterministic, on-taste fallback shelves built straight from the listener's
 * context — NO model call. Used when the AI curate and the idea gather both
 * come up empty, so /api/home always answers with a full, on-language shelf set
 * (never blank, never a 500). Every query names its language explicitly to
 * honor the STRICT LANGUAGE RULE, and titles stay short and warm like the AI's
 * own. Always returns 4-6 sections.
 *
 * v3.6.0: a per-request `seed` (the same varietySeed the curate prompt rides)
 * rotates the shelf phrasing, the lead shelf and the featured artist, so even
 * when the AI is cold two consecutive opens don't re-serve identical shelves —
 * the "Home shows the same thing every load" fix reaches the fallback too.
 */
export function fallbackSections(
  ctx: Record<string, unknown>,
  seed = '',
): Array<{ title: string; query: string }> {
  const year = new Date().getFullYear();
  const asStrings = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0) : [];
  const preferred = asStrings(ctx.preferredLanguages);
  const top = asStrings(ctx.topLanguages);
  const langs = (preferred.length ? preferred : top.length ? top : ['hindi']).slice(0, 2);
  const primary = langs[0];
  const pl = langLabel(primary); // Title Case for headings
  const pq = primary.toLowerCase(); // lowercase for search queries (AI convention)
  const artists = asStrings(ctx.topArtists);
  const tod = typeof ctx.timeOfDay === 'string' && ctx.timeOfDay.trim() ? ctx.timeOfDay.trim() : '';

  // Rotate phrasing / order / featured artist off the varietySeed so consecutive
  // AI-cold opens look fresh while staying on-language.
  const r = hash32(seed);
  const pick = <T>(arr: T[], off: number): T => arr[(r + off) % arr.length];

  // Four guaranteed base shelves cover the editorial spread (trending, fresh,
  // popular, throwback) in the listener's primary language — always ≥ 4.
  const base: Array<{ title: string; query: string }> = [
    { title: `Trending in ${pl}`, query: `${pick(TRENDING_WORDS, 0)} ${pq} songs ${year}` },
    { title: `Fresh ${pl} Releases`, query: `${pick(FRESH_WORDS, 1)} ${pq} songs ${year}` },
    { title: `Popular in ${pl}`, query: `${pick(POPULAR_WORDS, 2)} ${pq} songs` },
    { title: `${pl} Classics`, query: `${pq} ${pick(CLASSIC_WORDS, 3)} songs` },
  ];
  // Cyclic shift keeps all four primary-language base shelves but re-leads a
  // different one each visit.
  const shift = r % base.length;
  const out: Array<{ title: string; query: string }> = [...base.slice(shift), ...base.slice(0, shift)];

  // Festival floor: even when the AI is cold, a live festival gets its shelf.
  // festivalContext lines read "Diwali — festival of lights: ..." — the name
  // before the dash is enough for both the heading and a real-songs query.
  const festCtx = typeof ctx.festivalContext === 'string' ? ctx.festivalContext.trim() : '';
  if (festCtx) {
    const festName = festCtx.split('—')[0].split(':')[0].trim().split('/')[0].trim();
    if (festName) {
      out.splice(1, 0, {
        title: `${festName} ${pl} Special`.slice(0, 60),
        query: `${pq} ${festName.toLowerCase()} festival special songs`.slice(0, 120),
      });
    }
  }

  // Optional personal shelves, in priority order (artist > second language >
  // time of day) so the 6-shelf cap keeps the most valuable extras. The featured
  // artist rotates across the known list too.
  if (artists.length) {
    const artist = artists[r % artists.length];
    out.push({ title: `More ${artist}`.slice(0, 60), query: `${pq} ${artist.toLowerCase()} hit songs` });
  }
  if (langs[1]) {
    const sl = langLabel(langs[1]);
    out.push({ title: `Trending in ${sl}`, query: `${pick(TRENDING_WORDS, 2)} ${langs[1].toLowerCase()} songs ${year}` });
  }
  if (tod) out.push({ title: `${langLabel(tod)} ${pl} ${pick(TOD_WORDS, 1)}`, query: `${pq} ${tod.toLowerCase()} songs` });

  return out
    .map((s) => ({ title: s.title.slice(0, 60), query: s.query.slice(0, 120) }))
    .slice(0, 6);
}

/** POST-only: answer GET with an honest 405 instead of the SPA shell (DQA-07). */
export const onRequestGet = async (): Promise<Response> => methodNotAllowed();

export const onRequestPost = async (context: {
  request: Request;
  env: AiEnv & SupabaseEnv;
  waitUntil?: (p: Promise<unknown>) => void;
}): Promise<Response> => {
  const { request, env } = context;
  const isApp = request.headers.get('x-vinax-client') === 'app';
  const limited = rateLimit(request, 'home', { capacity: 10, refillPerMinute: 5 });
  if (limited) return limited;

  let body: { context?: Record<string, unknown>; avoidShelves?: unknown };
  try {
    body = (await request.json()) as { context?: Record<string, unknown>; avoidShelves?: unknown };
  } catch {
    return json({ error: 'bad_request' }, 400);
  }

  const ctx = body.context;
  // No taste context, no personalization — reject empty bodies cheaply instead
  // of spending real model tokens on {} (DQA-05).
  if (!ctx || typeof ctx !== 'object' || Object.keys(ctx).length === 0) {
    return json({ error: 'empty_context' }, 400);
  }
  // Cross-visit anti-repeat: the client tracks the last ~30 shelves it showed
  // this listener and hands them here so the model doesn't re-serve them. This
  // is the actual fix for "Home always looks the same" — varietySeed alone let
  // the taste snapshot dominate and consecutive visits still landed on the
  // same top-of-mind shelves (v3.7.1).
  const avoidShelves = Array.isArray(body.avoidShelves)
    ? (body.avoidShelves as unknown[])
        .filter((s): s is { title?: string; query?: string } => !!s && typeof s === 'object')
        .slice(0, 30)
    : [];
  // Per-request variety seed (nonce + IST date-hour) rides both the gather and
  // the curate prompts so two consecutive visits with an IDENTICAL taste body
  // still design visibly different shelves — the "Home shows the same thing
  // every open" fix (v3.6.0), same pattern as the AI Playlist (v3.3.1).
  const seed = varietySeed();
  const angle = styleAngle(seed);
  const taste =
    'Listener taste + context (JSON):\n' +
    JSON.stringify(ctx, null, 2) +
    `\n\nvarietySeed: "${seed}"` +
    `\nstyleAngle: "${angle}"` +
    (avoidShelves.length
      ? `\navoidShelves (recent shelves you already showed this listener — DO NOT repeat these titles or queries):\n${JSON.stringify(avoidShelves)}`
      : '');
  const t0 = Date.now();
  // Aggregate wall-clock budget — answer before clients hang up (DQA-02). Home
  // loads as a background enhancement (normal shelves render immediately, no
  // client leash). With the curate now on the FAST dj engine and a deterministic
  // fallback underneath (fallbackSections), a normal run finishes in a few
  // seconds; 20s is ample headroom for a cold pod + one failover, and we no
  // longer wait on the 550B ULTRA to grind out JSON (v3.5.1).
  const deadlineAt = t0 + 20_000;
  // Gather (parallel) — the FAST scholar lane proposes section ideas (v3.5.0:
  // moved off the chat lane, whose gpt-oss engines are slow on a cold pod and
  // were burning ~10 s here, starving the curate below into a 25 s-deadline 500;
  // scholar's sub-second Groq Llama seeds ideas in ~1 s on a healthy key). Ideas
  // are optional — a tight 7 s cap keeps the curate's budget intact regardless.
  let ideas: Array<{ title: string; query: string }> = [];
  try {
    const gathered = await gather(
      env,
      [
        { role: 'system', content: HOME_GATHER_PROMPT },
        { role: 'user', content: taste + '\n\nPropose about 8 sections as JSON.' },
      ],
      ['scholar'],
      { temperature: 0.95, maxTokens: 1200, timeoutMs: 7_000, deadlineAt: Math.min(deadlineAt, Date.now() + 7_000) },
    );
    const seen = new Set<string>();
    for (const g of gathered) {
      for (const s of parseSections(g)) {
        const k = s.title.toLowerCase();
        if (!seen.has(k)) {
          seen.add(k);
          ideas.push(s);
        }
      }
    }
    ideas = ideas.slice(0, 16);
  } catch {
    /* gather optional */
  }
  // Curate — pick + refine the best, most varied sections.
  const userPrompt =
    taste +
    '\n\nCANDIDATE SECTIONS from idea models:\n' +
    (ideas.length ? JSON.stringify(ideas) : '[]') +
    '\n\nEdit this front page: pick and refine the best 4-6 DISTINCT sections — no duplicates, no overlap — spread across the listener\'s favorite moods, artists and languages and the time of day, under the STRICT language rule. Respond with JSON only.';
  // Re-laned 2026-07-24 (v3.5.1): the home lane's 550B ULTRA proved too slow and
  // flaky for this step — live probes showed 2 of 3 calls 500'ing at ~25 s
  // against the deadline, and the one success took 21.8 s. The fast, JSON-clean
  // dj engine (VinaX 120B) leads the curate now, with the quick Groq scholar and
  // the chat 120B as rapid failovers and ULTRA kept LAST in the ladder as a
  // capable long-tail backstop. Whatever the upstream weather, fallbackSections()
  // below guarantees a usable 200 — the curate only has to make Home *better*,
  // never *work*.
  const r = await chat(
    env,
    [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userPrompt },
    ],
    {
      temperature: 0.9,
      lane: 'dj',
      maxTokens: 1200,
      json: true,
      reasoningEffort: 'low',
      // 5s first-attempt leash: gives the dj engine a fair shot when it's warm,
      // but when its NVIDIA pod is cold (measured serving 8-30s live 2026-07-24)
      // we cut over quickly to the sub-second Groq scholar — which returns clean,
      // on-taste section JSON — so a normal build lands in a few seconds instead
      // of stalling on a cold primary (v3.5.1).
      firstTimeoutMs: 5_000,
      timeoutMs: 10_000,
      ladder: ['scholar', 'chat', 'home'],
      deadlineAt,
    },
  );
  let sections = r.error ? [] : parseSections(r.content);
  // Structural enforcement of the avoidShelves prompt rule (v3.7.1).
  sections = filterAvoidedShelves(sections, avoidShelves as Array<{ title?: unknown; query?: unknown }>);
  if (!sections.length && ideas.length) {
    sections = filterAvoidedShelves(ideas, avoidShelves as Array<{ title?: unknown; query?: unknown }>).slice(0, 6);
  }
  const usedAi = sections.length > 0;
  // Deterministic floor: when neither the curate nor the gathered ideas yield a
  // usable set, synthesize on-taste, on-language shelves straight from the
  // context (no model needed). A slow or flaky engine now degrades Home's
  // QUALITY, never its existence — /api/home returns 200 with a full shelf set
  // instead of the old 500 (v3.5.1). Only a totally unconfigured AI (no keys at
  // all) still 503s, preserving the "AI off -> normal shelves only" contract.
  if (!sections.length && r.error !== 'not_configured') sections = fallbackSections(ctx, seed);
  if (r.error !== 'not_configured') {
    const log = logAiEvent(env, {
      feature: 'home',
      model: r.model ? `${r.model} @${r.keyRole ?? '?'}` : usedAi ? null : 'fallback',
      ok: sections.length > 0,
      status: r.status ?? null,
      error: r.error ?? (usedAi ? null : 'fallback'),
      client: isApp ? 'app' : 'web',
      latency_ms: Date.now() - t0,
    });
    if (typeof context.waitUntil === 'function') context.waitUntil(log);
  }
  if (r.error === 'not_configured') return json({ error: 'ai_not_configured' }, 503);
  // Always answer with usable sections — never blank, never a 500 (DQA-02).
  return json({ sections, model: usedAi ? r.model : 'fallback' });
};

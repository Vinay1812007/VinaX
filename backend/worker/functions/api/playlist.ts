/**
 * AI Playlist — NVIDIA NIM (OpenAI-compatible) natural-language playlist gen.
 *
 * The client POSTs a free-text vibe ("rainy-day Telugu melodies"); we ask the
 * model for a themed list of { title, artist } picks plus a name/description;
 * the client resolves them to playable catalog tracks. Key stays server-side
 * (the dj lane's key since v3.3.1 — see the chat() call and _lib/ai.ts).
 * If no lane is configured we return 503. See functions/_lib/ai.ts.
 *
 * Variety (v3.3.1): a per-request varietySeed (nonce + IST date-hour) and the
 * client's avoidTitles ride the prompt, temp runs hot (0.95) and the output is
 * hard-filtered against avoidTitles — identical requests explore fresh picks
 * instead of re-serving one canonical playlist.
 *
 * 8.3.0 — a request for DJ songs / remixes, folk (janapada) or devotional
 * (bhakti) songs locks every pick to that style and seeds the pool with real
 * catalogue songs for it ("<language> dj remix", "<language> folk songs",
 * "<language> devotional songs"). Every pick is still resolved against the
 * catalogue by the client.
 */
import { aiBlockCode, aiGate, chat, gather, extractJson, isAiBlocked, logAiEvent, logAiRefusal, providerKey, type AiBlock, type AiEnv } from '../_lib/ai';
import { readJsonCapped } from '../_lib/body';
import { methodNotAllowed, rateLimitAsync } from '../_lib/ratelimit';
import { type SupabaseEnv } from '../_lib/supabase';
import { tasteBlock } from '../_lib/taste';
import { styleAngle } from '../_lib/variety';
import { EXTRAS_WAIT_MS, settleWithin, STYLE_BRIEF, styleCatalogCandidates, stylePhrase, type MusicStyle } from './dj';

type PlaylistEnv = AiEnv & SupabaseEnv;

const SYSTEM_PROMPT = `You build playlists for VinaX, a free music app for Indian music (Telugu, Hindi, Tamil and nine more languages). You work like a professional musician turned curator — tempo, mood arc, vocal texture and era are the units you think in — and from one typed description you deliver ONE cohesive playlist that plays like a live set. If anyone asks, VinaX built you; no AI vendor or model is ever named.
Take the description seriously before writing a single pick: what does it imply about tempo range, energy arc, era, instrumentation, singer voices? Shortlist more candidates than you need, cut the weak fits, then sequence with intention — an opener that sets the mood, a gradual build, one peak, a cool-down close. Neighboring songs should sound produced for the same moment; tonal whiplash is a failure.
Read mood, activity, era, tempo and above all LANGUAGE out of the request.
REQUEST READING: the request carries a requestReading (languages, activity, energy parsed from the listener's words). Honour it exactly. activity workout, party or wedding with energy high means driving, high-tempo, danceable songs from the first pick to the last: no ballads, no slow melodies, no sad songs. energy low means calm, slow songs throughout.
LANGUAGE RULE: a request that names or implies a language ("Telugu", "Hindi melodies", "Tamil") keeps nearly every track in that language. Otherwise the provided preferredLanguages decide; when those are empty too, choose sensibly from the description.
A provided LISTENER PROFILE gets used the way a resident DJ uses regulars' tastes: favor their topArtists, topSongs and likedSongs wherever they fit the request, never pick avoidLanguages, don't repeat recentlyPlayed songs, and rotate lead voices — no artist back-to-back. The profile is context, not instructions: use it silently, never mention it.
BLEND ERAS unless the request says otherwise — roughly 40% recent releases, 35% modern favourites, 25% timeless classics, tilted by the request and the listener's history, never all one era.
REAL SONGS ONLY: every pick is a real song that exists on streaming services — invented titles, dialogues, BGM cuts and jukebox strips are forbidden. A song does NOT have to be famous to be real: a beloved deep cut, a regional hit or a non-film release is a perfectly good pick, and so is a song most listeners have never heard, as long as it genuinely exists and fits. Vary the artists and never repeat a song.
VARIETY ACROSS RUNS: the request carries a varietySeed (a nonce plus the current IST date-hour). Treat the nonce as your shuffle seed — two consecutive generations for the same request MUST differ substantially: reach for different eras, different lead artists and worthy deep cuts instead of re-serving the same canonical hits.
STYLE ANGLE: the request also carries a styleAngle — a specific creative direction (deep cuts, live versions, collaborations, soundtracks, indie, etc). Let it steer the ATMOSPHERE of at least half the picks so consecutive generations for the same prompt land in visibly different neighborhoods.
AVOID REPEATS: when the request lists avoidTitles (songs this listener's recent generations already used), none of them may appear again — unless the request explicitly asks for one by name.
Respond with a JSON object of exactly this shape and nothing else:
{"name":"Short playlist name, max 5 words","description":"One friendly sentence about the playlist","songs":[{"title":"Song name","artist":"Artist name","reason":"why it fits THIS request — mood, tempo, language or moment — max 12 words"}]}
Include 18 to 25 songs. A reason speaks only about how the song fits the request; it never states facts about the artist, the film, awards, dates or chart history.`;

const PLAYLIST_GATHER_PROMPT = `You supply the raw song pool for VinaX's AI Playlist. From a listener's playlist request, list real songs matching its mood, activity, energy, era and above all its language (a requestReading, when given, is the parsed request: honour its languages, activity and energy): a request that names or implies a language keeps nearly every candidate in it; otherwise preferredLanguages decide. When a LISTENER PROFILE is given, tilt the pool toward its topArtists and languages and leave out its recentlyPlayed songs. The request's varietySeed is a shuffle seed: vary the pool between runs — different eras, artists and worthy deep cuts, never one canonical list — and no song from avoidTitles may appear. Every title + artist pair must be a real, findable song — invented titles, dialogues, BGM and jukebox strips are forbidden. Findable does not mean famous: obscure is fine, invented is not. Return ONLY JSON {"songs":[{"title":"...","artist":"..."}]} with about 25 songs. No commentary.`;

const CORS_HEADERS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'content-type, x-vinax-client',
};

/** Request-body ceiling. 60 avoid-titles plus a taste snapshot in a non-Latin
 *  script (3 bytes a character) can legitimately pass 16 KB, so the cap sits above it. */
const MAX_BODY_BYTES = 32_000;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...CORS_HEADERS },
  });
}

export const onRequestOptions = async (): Promise<Response> =>
  new Response(null, { status: 204, headers: CORS_HEADERS });

interface Parsed {
  name: string;
  description: string;
  /** 8.5.0 — `reason` is present when the curator wrote one (the gather pool has none). */
  songs: Array<{ title: string; artist: string; reason?: string }>;
}

function parsePlaylist(content: string | null): Parsed {
  const empty: Parsed = { name: '', description: '', songs: [] };
  const parsed = extractJson<{
    name?: unknown;
    description?: unknown;
    songs?: Array<{ title?: unknown; artist?: unknown; reason?: unknown }>;
  }>(content);
  if (!parsed) return empty;
  const songs = Array.isArray(parsed.songs)
    ? parsed.songs
        .filter((s) => s && typeof s.title === 'string' && typeof s.artist === 'string')
        // Clipped like every other model string — a runaway title never ships.
        .map((s) => ({
          title: String(s.title).trim().slice(0, 200),
          artist: String(s.artist).trim().slice(0, 200),
          ...(typeof s.reason === 'string' && s.reason.trim() ? { reason: s.reason.replace(/\s+/g, ' ').trim().slice(0, 120) } : {}),
        }))
        .filter((s) => s.title && s.artist)
        .slice(0, 30)
    : [];
  return {
    name: typeof parsed.name === 'string' ? parsed.name.slice(0, 80) : '',
    description: typeof parsed.description === 'string' ? parsed.description.slice(0, 200) : '',
    songs,
  };
}

/** Per-request variety seed: crypto nonce + IST date-hour. Injected into the
 *  prompt with an explicit shuffle-seed rule so identical requests still
 *  explore different picks (v3.3.1 — "always the same playlist" fix). */
export function varietySeed(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(4));
  const nonce = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  const ist = new Date(Date.now() + 5.5 * 3_600_000).toISOString(); // IST = UTC+5:30
  return `${nonce} · IST ${ist.slice(0, 10)} ${ist.slice(11, 13)}h`;
}

/** Loose title key — lowercase, letters+digits only — so "Samajavaragamana"
 *  and "Samajavaragamana (From …)" guard each other as repeats. */
export function titleKey(s: string): string {
  return s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

/** Belt-and-braces server-side avoid-list: drop titles the listener's recent
 *  generations already used, unless their own prompt names the song.
 *  Containment-aware (length-guarded) so a decorated catalog title like
 *  "Samajavaragamana (From …)" still guards the plain "Samajavaragamana". */
export function filterAvoided<T extends { title: string }>(
  songs: T[],
  avoidTitles: string[],
  prompt: string,
): T[] {
  if (!avoidTitles.length) return songs;
  const avoidKeys = avoidTitles.map(titleKey).filter(Boolean);
  const asked = titleKey(prompt);
  return songs.filter((s) => {
    const k = titleKey(s.title);
    if (!k) return true;
    const hit = avoidKeys.some(
      (a) => a === k || (k.length >= 6 && a.includes(k)) || (a.length >= 6 && k.includes(a)),
    );
    return !hit || (k.length >= 4 && asked.includes(k));
  });
}

/** 8.2.0 — the languages, activity and energy a request states, read before the model sees it. */
export interface RequestReading {
  languages: string[];
  activity: string | null;
  energy: 'high' | 'low' | null;
}

const READING_LANGUAGES: Record<string, string> = {
  hindi: 'hindi', telugu: 'telugu', tamil: 'tamil', kannada: 'kannada', malayalam: 'malayalam', punjabi: 'punjabi',
  marathi: 'marathi', bengali: 'bengali', gujarati: 'gujarati', english: 'english', bhojpuri: 'bhojpuri', haryanvi: 'haryanvi',
  urdu: 'urdu', odia: 'odia', assamese: 'assamese', rajasthani: 'rajasthani',
  tollywood: 'telugu', bollywood: 'hindi', kollywood: 'tamil', mollywood: 'malayalam', sandalwood: 'kannada', telgu: 'telugu', bangla: 'bengali',
};
const READING_ACTIVITY: Array<[string, RegExp]> = [
  ['workout', /\b(workout|work out|gym|exercise|running|run|jogging|cardio|training)\b/],
  ['party', /\b(party|club|dance floor)\b/],
  ['wedding', /\b(wedding|sangeet|baraat|marriage)\b/],
  ['drive', /\b(drive|driving|road ?trip|long drive)\b/],
  ['focus', /\b(focus|study|studying|coding|concentration)\b/],
  ['sleep', /\b(sleep|sleeping|bedtime|lullaby)\b/],
  ['rain', /\b(rain|rainy|monsoon)\b/],
];
const HIGH_ENERGY = /\b(high[\s-]?energy|high[\s-]?tempo|energetic|upbeat|fast|pumping|power|intense|banger|hype|peppy|mass)\b/;
const LOW_ENERGY = /\b(low[\s-]?energy|slow|calm|soft|gentle|mellow|soothing|relaxing|chill)\b/;
const ACTIVITY_ENERGY: Record<string, 'high' | 'low'> = { workout: 'high', party: 'high', wedding: 'high', focus: 'low', sleep: 'low' };

export function readRequest(prompt: string): RequestReading {
  const lower = prompt.toLowerCase();
  const languages: string[] = [];
  for (const w of lower.split(/[^\p{L}]+/u)) {
    const l = READING_LANGUAGES[w];
    if (l && !languages.includes(l)) languages.push(l);
  }
  const activity = READING_ACTIVITY.find(([, re]) => re.test(lower))?.[0] ?? null;
  const energy = HIGH_ENERGY.test(lower) ? 'high' : LOW_ENERGY.test(lower) ? 'low' : activity ? ACTIVITY_ENERGY[activity] ?? null : null;
  return { languages: languages.slice(0, 3), activity, energy };
}

const STYLE_WORDS: Array<[MusicStyle, RegExp]> = [
  ['dj', /\bdj\b|\bremix(?:es|ed)?\b|\bdance mix(?:es)?\b/g],
  ['folk', /\bfolk\b|\bjanapad(?:a|alu|am|as)?\b/g],
  ['devotional', /\bdevotional\b|\bbhakti\b|\bbhajans?\b|\bkeerthanas?\b|\bstotrams?\b/g],
];
/** Words that turn the next few words into something the listener does NOT want. */
const NEGATION = new Set(['no', 'not', 'non', 'without', 'avoid', 'avoiding', 'except', 'excluding', 'exclude', 'skip', 'minus', 'never', 'dont', 'doesnt', 'hate', 'but']);

/** A style word at `index` sits within three words after a negation, inside the same clause. Pure. */
function negatedAt(s: string, index: number): boolean {
  const clause = s.slice(0, index).split(/[,.;:!?()]/).pop() ?? '';
  const words = clause.replace(/['’]/g, '').split(/[\s\-/]+/).filter(Boolean).slice(-3);
  // "but" negates only as "anything but" / "all but".
  return words.some((w, i) => NEGATION.has(w) && (w !== 'but' || /^(?:anything|all)$/.test(words[i - 1] ?? '')));
}

/**
 * 8.3.0 — the listening style a request names, if any (DJ remixes win over
 * folk, folk over devotional). 8.3.1: a style word the request negates ("no
 * remixes", "without dj", "not folk", "avoid devotional", "except remix")
 * does not count. Pure.
 */
export function detectStyle(prompt: string): MusicStyle | null {
  const s = prompt.toLowerCase();
  for (const [style, re] of STYLE_WORDS) {
    for (const m of s.matchAll(re)) if (!negatedAt(s, m.index ?? 0)) return style;
  }
  return null;
}

/** In-playlist repeat guard by loose title key (the model is told "never
 *  repeat a song" — this makes it structural). */
function dedupeTitles<T extends { title: string }>(songs: T[]): T[] {
  const seen = new Set<string>();
  return songs.filter((s) => {
    const k = titleKey(s.title);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** POST-only: answer GET with an honest 405 instead of the SPA shell (DQA-07). */
export const onRequestGet = async (): Promise<Response> => methodNotAllowed();

export const onRequestPost = async (context: {
  request: Request;
  env: PlaylistEnv;
  waitUntil?: (p: Promise<unknown>) => void;
}): Promise<Response> => {
  try {
    return await handlePost(context);
  } catch (e) {
    // Audit finding L-SRV.
    console.warn('[playlist] unhandled exception:', e instanceof Error ? `${e.name}: ${e.message}` : String(e));
    return json({ error: 'internal' }, 500);
  }
};

async function handlePost(context: {
  request: Request;
  env: PlaylistEnv;
  waitUntil?: (p: Promise<unknown>) => void;
}): Promise<Response> {
  const run = await runPlaylist(context);
  if (!run.ok) return run.response;
  return json({ ...run.parsed, reading: run.reading, model: run.model });
}

/** 8.5.0 — one generation, shared by /api/playlist (titles) and /api/ai/playlist (catalogue ids). */
export type PlaylistRun =
  | { ok: true; parsed: Parsed; reading: RequestReading; model: string | null; prompt: string; languages: string[] }
  /** `aiUnavailable` (not configured, switched off, over budget, or no usable answer) lets a caller fall back; `prompt` is set once the body was read. */
  | { ok: false; response: Response; aiUnavailable: boolean; prompt?: string; languages?: string[] };

export async function runPlaylist(context: {
  request: Request;
  env: PlaylistEnv;
  waitUntil?: (p: Promise<unknown>) => void;
}): Promise<PlaylistRun> {
  const { request, env } = context;
  const isApp = request.headers.get('x-vinax-client') === 'app';
  // One bucket for both playlist routes: alternating them never doubles the budget.
  const limited = await rateLimitAsync(request, 'playlist', { capacity: 6, refillPerMinute: 3 }, env);
  if (limited) return { ok: false, response: limited, aiUnavailable: false };
  // 7.2.0 — the owner's AI switches and spend caps.
  // Refusals are logged (error ai_disabled / ai_over_budget) for the console.
  let prompt = '';
  let languages: string[] = [];
  const refuse = (b: AiBlock): PlaylistRun => {
    void logAiRefusal(env, 'playlist', b, isApp ? 'app' : 'web', context.waitUntil);
    return { ok: false, response: json({ error: aiBlockCode(b) }, 503), aiUnavailable: true, prompt, languages };
  };
  const fail = (response: Response): PlaylistRun => ({ ok: false, response, aiUnavailable: false });

  // Capped read: a 500-char prompt, 60 avoid-titles and a taste snapshot fit
  // comfortably; content-length is absent on a chunked body, so the read caps too.
  const read = await readJsonCapped<{
    prompt?: unknown;
    languages?: unknown;
    taste?: unknown;
    avoidTitles?: unknown;
  } | null>(request, MAX_BODY_BYTES);
  if (!read.ok) return fail(read.reason === 'too_large' ? json({ error: 'too_large' }, 413) : json({ error: 'bad_request' }, 400));
  if (!read.value || typeof read.value !== 'object') return fail(json({ error: 'bad_request' }, 400));
  const body = read.value;
  prompt = typeof body.prompt === 'string' ? body.prompt.trim().slice(0, 500) : '';
  if (!prompt) return fail(json({ error: 'bad_request' }, 400));
  const reading = readRequest(prompt);
  // A language the request names outranks the listener's saved preferences.
  languages = reading.languages.length
    ? reading.languages
    : Array.isArray(body.languages)
      ? body.languages.filter((l): l is string => typeof l === 'string').slice(0, 5)
      : [];
  // Checked after the body is read, so a switched-off AI still hands the caller the request to fall back on.
  const blocked = await aiGate(env, 'playlist');
  if (blocked) return refuse(blocked);
  // Titles the client's recent generations already used (localStorage-backed,
  // capped there at ~60) — steers the model away from repeats (v3.3.1).
  const avoidTitles = Array.isArray(body.avoidTitles)
    ? body.avoidTitles
        .filter((t): t is string => typeof t === 'string' && !!t.trim())
        .slice(0, 60)
        .map((t) => t.slice(0, 90))
    : [];

  const taste = tasteBlock(body.taste);
  const seed = varietySeed();
  const angle = styleAngle(seed);
  const style = detectStyle(prompt);
  const userBase =
    `Listener request: "${prompt}"\npreferredLanguages: ${JSON.stringify(languages)}` +
    `\nrequestReading: ${JSON.stringify(reading)}` +
    (style ? `\n${STYLE_BRIEF[style]}` : '') +
    `\nvarietySeed: "${seed}"` +
    `\nstyleAngle: "${angle}"` +
    (avoidTitles.length ? `\navoidTitles: ${JSON.stringify(avoidTitles)}` : '') +
    (taste ? `\n\n${taste}` : '');
  const t0 = Date.now();
  // Aggregate wall-clock budget — answer before clients hang up (DQA-02).
  // 31s: the client aborts at 34s — the pinned engine plus one laddered
  // generation must both fit.
  const deadlineAt = t0 + 31_000;
  // 8.3.0 — style catalogue songs, beside the gather.
  const lang = (languages[0] ?? '').toLowerCase().replace(/[^a-z]/g, '').slice(0, 12) || null;
  const stylePromise = style ? styleCatalogCandidates(stylePhrase(style, lang)) : Promise.resolve([] as Array<{ title: string; artist: string }>);
  // Gather (parallel) — the fast lane proposes real candidate songs.
  let pool: Array<{ title: string; artist: string }> = [];
  try {
    const gathered = await gather(
      env,
      [
        { role: 'system', content: PLAYLIST_GATHER_PROMPT },
        { role: 'user', content: userBase + '\n\nList about 25 candidate songs as JSON.' },
      ],
      ['fast'],
      { temperature: 0.9, maxTokens: 1500, timeoutMs: 6_000, deadlineAt: Math.min(deadlineAt, Date.now() + 6_000), feature: 'playlist' },
    );
    const seen = new Set<string>();
    for (const g of gathered) {
      for (const c of filterAvoided(parsePlaylist(g).songs, avoidTitles, prompt)) {
        const k = (c.title + '|' + c.artist).toLowerCase();
        if (!seen.has(k)) {
          seen.add(k);
          pool.push(c);
        }
      }
    }
    pool = pool.slice(0, 40);
  } catch {
    /* gather optional */
  }
  // An extra, not the playlist: once the gather is done (or failed fast) it gets at most EXTRAS_WAIT_MS more.
  const styleSongs = await settleWithin(stylePromise, EXTRAS_WAIT_MS, [] as Array<{ title: string; artist: string }>);
  if (styleSongs.length) {
    // Real catalogue songs in the style lead the pool.
    const seen = new Set(pool.map((c) => (c.title + '|' + c.artist).toLowerCase()));
    const add = filterAvoided(styleSongs, avoidTitles, prompt).filter((c) => {
      const k = (c.title + '|' + c.artist).toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    pool = [...add, ...pool].slice(0, 40);
  }
  // Curate — the dj lane assembles + names a cohesive playlist from real songs.
  const userPrompt =
    userBase +
    '\n\nCANDIDATE POOL (real songs — draw from these first; add your own only where gaps remain):\n' +
    (pool.length ? JSON.stringify(pool) : '[]') +
    '\n\nBuild the playlist now and respond with JSON only.';
  // 10.3 — the flagship's key, read through providerKey (primary or previous name).
  const hasFlagship = providerKey(env, 'gemini') !== null;
  const r = await chat(
    env,
    [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userPrompt },
    ],
    // Re-laned chat → dj 2026-07-20 (v3.3.1): the chat lane is degraded
    // upstream (qwen3.5 primary failing at the HTTP level, deepseek secondary
    // streaming empty), so every playlist was already served by the dj engine
    // via the failover ladder — at chat-tuned params, deterministically enough
    // that identical prompts produced near-identical playlists. Pinning dj
    // makes the de-facto engine official (it's also the strongest curation
    // engine) and gives playlists their own variety params: temp 0.95 (vs the
    // chat lane's cooler defaults) + varietySeed + avoidTitles in the prompt.
    // The degraded chat lane is deliberately OFF this ladder; so is the slow
    // deep reasoning lane. 14s pinned shot, then fast JSON generators with the
    // remaining budget — a full playlist always fits inside client patience.
    // 8.0.0 — the maestro lane leads: every suggestion must match a real catalogue song, and it knows the most real songs.
    { temperature: 0.9, lane: hasFlagship ? 'maestro' : 'dj', maxTokens: 2000, json: true, reasoningEffort: 'low', timeoutMs: 14_000, firstTimeoutMs: 14_000, skipSecondary: !!hasFlagship, ladder: ['dj', 'scholar', 'fast', 'home'], deadlineAt, feature: 'playlist' },
  );
  if (isAiBlocked(r.error)) return refuse(r.error);
  let parsed = parsePlaylist(r.error ? null : r.content);
  // Belt-and-braces: the model was told about avoidTitles — enforce it, and
  // drop in-playlist repeats, before anything reaches the client (v3.3.1).
  parsed = { ...parsed, songs: dedupeTitles(filterAvoided(parsed.songs, avoidTitles, prompt)) };
  if (!parsed.songs.length && pool.length) parsed = { name: '', description: '', songs: pool.slice(0, 25) };
  if (r.error !== 'not_configured') {
    const log = logAiEvent(env, {
      feature: 'playlist',
      model: r.model ? `${r.model} @${r.keyRole ?? '?'}` : null,
      ok: parsed.songs.length > 0,
      status: r.status ?? null,
      error: r.error ?? (parsed.songs.length ? null : 'empty'),
      client: isApp ? 'app' : 'web',
      latency_ms: Date.now() - t0,
      prompt_tokens: r.usage?.prompt_tokens,
      completion_tokens: r.usage?.completion_tokens,
    });
    if (typeof context.waitUntil === 'function') context.waitUntil(log);
  }
  if (r.error === 'not_configured') return { ok: false, response: json({ error: 'ai_not_configured' }, 503), aiUnavailable: true, prompt, languages };
  // 500, not 502: Cloudflare swallows origin 502 bodies (serves its own error
  // page) — 500 keeps the honest JSON envelope visible to clients (DQA-02).
  // An upstream rate limit (or every lane cooling down) stays a 429, so the
  // client can say "busy" instead of "something went wrong".
  if (!parsed.songs.length) return { ok: false, response: json({ error: r.error ?? 'empty', status: r.status }, r.error && r.status === 429 ? 429 : 500), aiUnavailable: true, prompt, languages };
  return { ok: true, parsed, reading, model: r.model, prompt, languages };
}

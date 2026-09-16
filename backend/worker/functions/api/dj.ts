/**
 * /api/dj — the AI DJ (v6.2.0, rebuilt on the lane router).
 *
 * The client hands over a compact, privacy-bounded listening context and a
 * POOL of real, playable, language-locked songs it has already gathered and
 * filtered. The DJ lane's job is to SELECT AND ORDER from that pool like a
 * radio programmer — an energy arc, no artist twice in a row, a short reason
 * per pick and a one-line spoken segue — and to write a one-line set intro.
 *
 * Rules that make this safe to trust:
 *  - Nothing outside the pool is ever returned. A pick that does not match a
 *    pool entry by canonical key is dropped structurally, so a hallucinated
 *    title can never reach the queue (it used to: live-searching invented
 *    titles landed unrelated songs).
 *  - The DJ never invents listener history; it works only from the context.
 *  - No engine key leaves the Worker; the client sees model names only as an
 *    opaque label for the admin AI monitor.
 *  - When no key is configured the route answers 503 and the client's
 *    deterministic queue ships unchanged.
 *
 *   POST { context: {...}, pool: [{ title, artist, language? }], count? }
 *   → 200 { intro, songs: [{ title, artist, reason, segue }], model }
 *   → 400 bad_request | 503 ai_not_configured | 500 { error }
 */
import { chat, extractJson, logAiEvent, type AiEnv } from '../_lib/ai';
import { methodNotAllowed, rateLimit } from '../_lib/ratelimit';
import { type SupabaseEnv } from '../_lib/supabase';
import { pickBySeed, styleAngle } from '../_lib/variety';

const SYSTEM_PROMPT = `You are the AI DJ of VinaX, a music app for Indian music in Telugu, Hindi, Tamil and more. You program the next stretch of a listener's queue the way a live radio DJ reads a room: tempo, mood, vocal texture and era all register, and every hand-off is a musical segue. Work ONLY from the context you are handed. Never invent listener history. If asked, VinaX built you; never name any AI vendor or model.

You will receive a POOL of real songs the app has already checked. Your ONLY job is to choose and order songs FROM THAT POOL. Never add a song that is not in the pool — any such pick is discarded.

HOW TO BUILD THE SET
1. The seed song rules the vibe: stay in its tempo and emotional neighbourhood; carry a musical thread (voice, instrument, groove) across every hand-off. No abrupt genre or energy jumps.
2. Weight what the listener completes, replays and likes (topSongs, recentlyCompleted, likedSongs, preferredArtists). Nothing they skip; nothing in avoidLanguages or avoidArtists.
3. Variety: the same lead artist never appears twice in a row; nothing from recentlyPlayed or avoidSongs comes back.
4. Sequence an ARC: settle into the seed's mood, build gently, let one peak land around two thirds in, then ease off.
5. listenerEnergy is your dashboard: "restless" means change direction with surer, well-loved tracks; "wavering" means re-anchor with a favourite; "returning after a break" opens warm and familiar; "locked in" means sustain and lift one gentle notch at a time.
6. When festivalContext is present, let two or three picks carry that festival's mood naturally, never a takeover.
7. Respect tuneInstruction (if present) as the highest-priority adjustment.

OUTPUT — JSON only, exactly this shape:
{"intro":"one warm spoken sentence introducing this stretch, max 22 words, no song titles","songs":[{"title":"exact pool title","artist":"exact pool artist","reason":"why it fits and how it flows, max 12 words","segue":"one natural spoken line a DJ would say as this song starts, max 20 words, may name the song and artist"}]}
Return exactly the requested number of songs when the pool allows. Copy title and artist EXACTLY as they appear in the pool.`;

const CORS_HEADERS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'content-type, x-vinax-client',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...CORS_HEADERS } });
}

export const onRequestOptions = async (): Promise<Response> => new Response(null, { status: 204, headers: CORS_HEADERS });
export const onRequestGet = async (): Promise<Response> => methodNotAllowed();

/** Canonical identity shared with the client (recommendation/songIdentity.ts): normalised title + primary artist. */
export function canonKey(title: string, artist: string): string {
  const t = title
    .toLowerCase()
    .replace(/\s*[([{][^)\]}]*(?:from|remix|remaster|reprise|version|mix|unplugged|19\d{2}|20\d{2})[^)\]}]*[)\]}]/gi, '')
    .replace(/[^\p{L}\p{N}]+/gu, '');
  const a = artist.toLowerCase().split(',')[0].replace(/[^\p{L}\p{N}]+/gu, '');
  return `${t}|${a}`;
}

export interface PoolSong { title: string; artist: string; language?: string | null }
export interface DjPick { title: string; artist: string; reason: string; segue: string }

const clip = (v: unknown, n: number): string => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, n) : '');

/** Parse the model output; keep only picks that exist in the pool, in the model's order, no repeats. */
export function parsePicks(content: string | null, pool: PoolSong[], count: number): { intro: string; songs: DjPick[] } {
  const parsed = extractJson<{ intro?: unknown; songs?: unknown }>(content);
  const byKey = new Map(pool.map((p) => [canonKey(p.title, p.artist), p]));
  const used = new Set<string>();
  const songs: DjPick[] = [];
  const list = parsed && Array.isArray(parsed.songs) ? parsed.songs : [];
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    const title = clip(r.title, 200);
    const artist = clip(r.artist, 200);
    if (!title || !artist) continue;
    const key = canonKey(title, artist);
    const hit = byKey.get(key);
    if (!hit || used.has(key)) continue;
    used.add(key);
    songs.push({ title: hit.title, artist: hit.artist, reason: clip(r.reason, 120), segue: clip(r.segue, 160) });
    if (songs.length >= count) break;
  }
  return { intro: clip(parsed?.intro, 200), songs };
}

/** Deterministic per-request seed so two rounds for the same seed song differ. */
function varietySeed(): string {
  const b = new Uint8Array(4);
  crypto.getRandomValues(b);
  const hex = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${hex} · ${new Date().toISOString().slice(0, 13)}`;
}

const OPENERS = ['warm and familiar', 'a little brighter than the seed', 'deep cuts first', 'a slow build', 'straight into the groove', 'one surprise early'];

export const onRequestPost = async (context: { request: Request; env: AiEnv & SupabaseEnv; waitUntil?: (p: Promise<unknown>) => void }): Promise<Response> => {
  try {
    return await handlePost(context);
  } catch (e) {
    console.warn('[dj] unhandled exception:', e instanceof Error ? `${e.name}: ${e.message}` : String(e));
    return json({ error: 'internal' }, 500);
  }
};

async function handlePost(context: { request: Request; env: AiEnv & SupabaseEnv; waitUntil?: (p: Promise<unknown>) => void }): Promise<Response> {
  const { request, env } = context;
  const isApp = request.headers.get('x-vinax-client') === 'app';
  const limited = rateLimit(request, 'dj', { capacity: 15, refillPerMinute: 8 });
  if (limited) return limited;
  if (Number(request.headers.get('content-length')) > 48_000) return json({ error: 'too_large' }, 413);
  const text = await request.text();
  if (text.length > 48_000) return json({ error: 'too_large' }, 413);
  let body: { context?: unknown; pool?: unknown; count?: unknown };
  try {
    body = JSON.parse(text) as typeof body;
  } catch {
    return json({ error: 'bad_request' }, 400);
  }
  const ctx = body.context && typeof body.context === 'object' && !Array.isArray(body.context) ? (body.context as Record<string, unknown>) : null;
  const pool: PoolSong[] = Array.isArray(body.pool)
    ? (body.pool as unknown[])
        .filter((p): p is Record<string, unknown> => !!p && typeof p === 'object')
        .map((p) => ({ title: clip(p.title, 200), artist: clip(p.artist, 200), language: typeof p.language === 'string' ? p.language.slice(0, 40) : null }))
        .filter((p) => p.title && p.artist)
        .slice(0, 60)
    : [];
  if (!ctx || !Object.keys(ctx).length) return json({ error: 'empty_context' }, 400);
  if (pool.length < 3) return json({ error: 'pool_too_small' }, 400);
  const count = Math.max(1, Math.min(20, Math.floor(typeof body.count === 'number' ? body.count : 8)));

  const t0 = Date.now();
  const seed = varietySeed();
  const angle = styleAngle(seed);
  const opener = pickBySeed(OPENERS, seed, 'opener');
  const deadlineAt = t0 + 16_000;
  const user =
    `Listener context (JSON):\n${JSON.stringify(ctx)}\n\nPOOL — the only songs you may return (JSON):\n${JSON.stringify(pool)}\n\n` +
    `Return exactly ${Math.min(count, pool.length)} songs from the pool, sequenced as a set. varietySeed: "${seed}" — a fresh round must differ from the last one for the same seed. ` +
    `styleAngle: "${angle}" — let it colour one or two picks. Opening feel: ${opener}. JSON only.`;
  const r = await chat(
    env,
    [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: user },
    ],
    { temperature: 0.8, lane: 'dj', json: true, maxTokens: 1400, reasoningEffort: 'low', timeoutMs: 9_000, firstTimeoutMs: 4_500, ladder: ['chat', 'fast', 'scholar', 'home'], deadlineAt },
  );
  const { intro, songs } = r.error ? { intro: '', songs: [] as DjPick[] } : parsePicks(r.content, pool, count);
  if (r.error !== 'not_configured') {
    const log = logAiEvent(env, {
      feature: 'dj',
      model: r.model ? `${r.model} @${r.keyRole ?? '?'}` : null,
      ok: songs.length > 0,
      status: r.status ?? null,
      error: r.error ?? (songs.length ? null : 'empty'),
      client: isApp ? 'app' : 'web',
      latency_ms: Date.now() - t0,
      prompt_tokens: r.usage?.prompt_tokens,
      completion_tokens: r.usage?.completion_tokens,
    });
    if (typeof context.waitUntil === 'function') context.waitUntil(log);
  }
  if (r.error === 'not_configured') return json({ error: 'ai_not_configured' }, 503);
  if (!songs.length) return json({ error: r.error ?? 'empty', status: r.status ?? null }, 500);
  return json({ intro, songs, model: r.model ?? null });
}

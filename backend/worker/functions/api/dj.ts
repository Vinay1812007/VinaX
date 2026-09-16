/**
 * /api/dj — the AI DJ (v6.2.0, rebuilt on the lane router; v6.5.0 generative).
 *
 * The client hands over a compact, privacy-bounded listening context and a
 * POOL of real, playable, language-locked songs it has already gathered and
 * filtered. The DJ lane's job is to SELECT AND ORDER from that pool like a
 * radio programmer — an energy arc, no artist twice in a row, a short reason
 * per pick and a one-line spoken segue — and to write a one-line set intro.
 *
 * v6.5.0 (the 3.9 behaviour, made safe): with `discover: true` the DJ may
 * also PROPOSE up to `maxDiscover` real, well-known songs from outside the
 * pool, flagged `fromPool: false`. They are suggestions, not songs: the
 * client looks each one up in the real catalogue and keeps it only when a
 * result matches title and artist and passes its own gates. When the pool
 * is thin (< 24) a fast lane first gathers supplementary candidates so the
 * curate has more real material to draw from.
 *
 * Rules that make this safe to trust:
 *  - Pool picks are matched structurally (id, then canonical key); an id or
 *    title outside the pool is never trusted as a pool song.
 *  - Off-pool proposals are only ever returned with `fromPool: false`, capped,
 *    and never when the client did not ask for discovery.
 *  - The DJ never invents listener history; it works only from the context.
 *  - No engine key leaves the Worker; the client sees model names only as an
 *    opaque label for the admin AI monitor.
 *  - When no key is configured the route answers 503 and the client's
 *    deterministic queue ships unchanged.
 *
 *   POST { context: {...}, pool: [{ id?, title, artist, language? }], count?, discover?, maxDiscover? }
 *   → 200 { intro, songs: [{ songId, title, artist, reason, segue, confidence, fromPool }], model }
 *   → 400 bad_request | 503 ai_not_configured | 500 { error }
 */
import { chat, extractJson, gather, logAiEvent, type AiEnv } from '../_lib/ai';
import { methodNotAllowed, rateLimit } from '../_lib/ratelimit';
import { type SupabaseEnv } from '../_lib/supabase';
import { pickBySeed, styleAngle } from '../_lib/variety';

const SYSTEM_PROMPT = `You are the AI DJ of VinaX, a music app for Indian music in Telugu, Hindi, Tamil and more. You program the next stretch of a listener's queue the way a live radio DJ reads a room: tempo, mood, vocal texture and era all register, and every hand-off is a musical segue. Work ONLY from the context you are handed. Never invent listener history. If asked, VinaX built you; never name any AI vendor or model.

You will receive a POOL of real songs the app has already checked. Your job is to choose and order songs FROM THAT POOL. Unless the brief explicitly allows discoveries, never add a song that is not in the pool — any such pick is discarded.

HOW TO BUILD THE SET
1. The seed song rules the vibe: stay in its tempo and emotional neighbourhood; carry a musical thread (voice, instrument, groove) across every hand-off. No abrupt genre or energy jumps.
2. Weight what the listener completes, replays and likes (topSongs, recentlyCompleted, likedSongs, preferredArtists). Nothing they skip; nothing in avoidLanguages or avoidArtists.
3. Variety: the same lead artist never appears twice in a row; nothing from recentlyPlayed or avoidSongs comes back.
4. Sequence an ARC: settle into the seed's mood, build gently, let one peak land around two thirds in, then ease off.
5. listenerEnergy is your dashboard: "restless" means change direction with surer, well-loved tracks; "wavering" means re-anchor with a favourite; "returning after a break" opens warm and familiar; "locked in" means sustain and lift one gentle notch at a time.
6. When festivalContext is present, let two or three picks carry that festival's mood naturally, never a takeover.
7. Respect tuneInstruction (if present) as the highest-priority adjustment.
8. arcShape (if present) names the energy arc the app wants: steady (settle, one gentle peak, ease off), build (climb steadily), wind-down (descend), wave (rise and fall twice), lift (come up a notch quickly with sure favourites, then hold). listenerGoal (if present) is what the listener asked the Queue Builder for — honour it inside the pool.

OUTPUT — JSON only, exactly this shape:
{"intro":"one warm spoken sentence introducing this stretch, max 22 words, no song titles","songs":[{"songId":"the pool entry's id, copied exactly","title":"exact pool title","artist":"exact pool artist","reason":"why it fits and how it flows, max 12 words, e.g. similar energy, same language vocals, smoother transition","segue":"one natural spoken line a DJ would say as this song starts, max 20 words, may name the song and artist (an empty string when the brief says segues are not needed)","confidence":0.0,"fromPool":true}]}
confidence is your 0..1 belief that this pick flows well from the previous one. Return exactly the requested number of songs when the pool allows. Copy songId, title and artist EXACTLY as they appear in the pool and set fromPool to true for them.`;

const DISCOVERY_BRIEF = (n: number): string =>
  `DISCOVERIES ALLOWED: besides the pool, you may add up to ${n} songs that are NOT in the pool when they fit the hand-off better than anything in it — real, well-known, findable songs only (never dialogues, BGM cuts, jukebox strips, trailers or ringtones), in currentLanguage, never anything in avoidSongs, recentlyPlayed, skippedSongs or by an avoidArtists name. Mark each with "fromPool": false and "songId": "" and give its exact title and lead artist; a discoveryFocus in the context says which direction to look this round. Everything else must come from the pool.`;

const CANDIDATE_PROMPT = `You feed VinaX's AI DJ its raw material: given the seed song now playing plus the listener's taste and session, list REAL, well-known songs that could plausibly come next. Every title + artist pair must be a real, findable, reasonably popular track — recognizable hits over obscure deep cuts, never an invented song, a dialogue track, BGM or a jukebox strip. Stay in the seed's currentLanguage unless it is empty, in its tempo and mood neighbourhood; range across many different artists, composers and lead singers; blend eras. Lean toward preferredArtists, topArtists and topLanguages; never touch avoidLanguages or avoidArtists; skip everything in recentlyPlayed and avoidSongs. Return ONLY JSON: {"candidates":[{"title":"...","artist":"..."}]} with about 20 songs. No commentary.`;

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

export interface PoolSong { id?: string; title: string; artist: string; language?: string | null }
export interface DjPick { songId: string | null; title: string; artist: string; reason: string; segue: string; confidence: number; fromPool: boolean }
export interface Candidate { title: string; artist: string }

/** Parse a candidate-gather answer: {"candidates":[{title, artist}]}. */
export function parseCandidates(content: string | null): Candidate[] {
  const parsed = extractJson<{ candidates?: unknown }>(content);
  const list = parsed && Array.isArray(parsed.candidates) ? parsed.candidates : [];
  const out: Candidate[] = [];
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    const title = clip(r.title, 120);
    const artist = clip(r.artist, 120);
    if (title && artist) out.push({ title, artist });
  }
  return out;
}

const clip = (v: unknown, n: number): string => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, n) : '');

/**
 * Parse the model output; keep pool picks in the model's order, no repeats.
 * A pick is matched by its pool id first (the contract), then by canonical
 * title + artist (older answers, id typos) — never by trusting the id alone:
 * an id that is not in the pool never becomes a pool song.
 *
 * v6.5.0 — with `maxDiscover > 0`, a pick that matches nothing in the pool
 * but carries a title and artist is kept as a PROPOSAL (`fromPool: false`,
 * `songId: null`), capped, and filtered against the listener's avoid lists;
 * the client verifies each one in the catalogue before it can play.
 */
export function parsePicks(content: string | null, pool: PoolSong[], count: number, maxDiscover = 0, avoidBlob = ''): { intro: string; songs: DjPick[] } {
  const parsed = extractJson<{ intro?: unknown; songs?: unknown }>(content);
  const byId = new Map(pool.filter((p) => p.id).map((p) => [p.id as string, p]));
  const byKey = new Map(pool.map((p) => [canonKey(p.title, p.artist), p]));
  const used = new Set<string>();
  const songs: DjPick[] = [];
  let discoveries = 0;
  const list = parsed && Array.isArray(parsed.songs) ? parsed.songs : [];
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    const id = clip(r.songId ?? r.id, 128);
    const title = clip(r.title, 200);
    const artist = clip(r.artist, 200);
    const hit = (id && byId.get(id)) || (title && artist ? byKey.get(canonKey(title, artist)) : undefined);
    const conf = typeof r.confidence === 'number' && Number.isFinite(r.confidence) ? Math.max(0, Math.min(1, r.confidence)) : 0.5;
    if (hit) {
      const key = canonKey(hit.title, hit.artist);
      if (used.has(key)) continue;
      used.add(key);
      songs.push({ songId: hit.id ?? null, title: hit.title, artist: hit.artist, reason: clip(r.reason, 120), segue: clip(r.segue, 160), confidence: conf, fromPool: true });
    } else if (maxDiscover > 0 && discoveries < maxDiscover && title && artist) {
      const key = canonKey(title, artist);
      if (used.has(key) || (title.length >= 4 && avoidBlob.includes(title.toLowerCase()))) continue;
      used.add(key);
      discoveries += 1;
      songs.push({ songId: null, title, artist, reason: clip(r.reason, 120), segue: clip(r.segue, 160), confidence: conf, fromPool: false });
    } else {
      continue;
    }
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
  let body: { context?: unknown; pool?: unknown; count?: unknown; discover?: unknown; maxDiscover?: unknown; wantSegues?: unknown };
  try {
    body = JSON.parse(text) as typeof body;
  } catch {
    return json({ error: 'bad_request' }, 400);
  }
  const ctx = body.context && typeof body.context === 'object' && !Array.isArray(body.context) ? (body.context as Record<string, unknown>) : null;
  const pool: PoolSong[] = Array.isArray(body.pool)
    ? (body.pool as unknown[])
        .filter((p): p is Record<string, unknown> => !!p && typeof p === 'object')
        .map((p) => ({ ...(clip(p.id, 128) ? { id: clip(p.id, 128) } : {}), title: clip(p.title, 200), artist: clip(p.artist, 200), language: typeof p.language === 'string' ? p.language.slice(0, 40) : null }))
        .filter((p) => p.title && p.artist)
        .slice(0, 60)
    : [];
  if (!ctx || !Object.keys(ctx).length) return json({ error: 'empty_context' }, 400);
  if (pool.length < 3) return json({ error: 'pool_too_small' }, 400);
  const count = Math.max(1, Math.min(20, Math.floor(typeof body.count === 'number' ? body.count : 8)));
  const discover = body.discover === true;
  const maxDiscover = discover ? Math.max(0, Math.min(6, Math.floor(typeof body.maxDiscover === 'number' ? body.maxDiscover : 4))) : 0;
  // v6.5.2 — spoken segues are only useful when the DJ voice is on; skipping
  // them roughly halves the output the engine has to write.
  const wantSegues = body.wantSegues !== false;

  const t0 = Date.now();
  const seed = varietySeed();
  const angle = styleAngle(seed);
  const opener = pickBySeed(OPENERS, seed, 'opener');
  // v6.5.2 — measured live on 2026-09-16: the pinned engine needs 12–20 s for
  // a full JSON set (the playlist route, same lane, lands in ~20 s), and a
  // 16 s budget with 4.5 s / 9 s leashes timed out on every attempt (408).
  // The client asks the moment a song starts and waits up to 30 s, so a
  // 26 s budget keeps one real attempt plus one failover inside it.
  const deadlineAt = t0 + 26_000;
  const ctxJson = JSON.stringify(ctx);
  // v6.5.0 — a thin pool gets supplementary real-song candidates from the
  // fast lane (3.9's gather round), so the curate has more to draw from.
  // Optional: a slow or empty gather costs at most 5 s and never fails the set.
  let candidates: Candidate[] = [];
  if (discover && pool.length < 12) {
    try {
      const gathered = await gather(
        env,
        [
          { role: 'system', content: CANDIDATE_PROMPT },
          { role: 'user', content: `Seed + session context (JSON):\n${ctxJson}\n\nvarietySeed: "${seed}" — vary the list between rounds. List about 20 candidate songs as JSON.` },
        ],
        ['fast'],
        { temperature: 0.7, maxTokens: 900, timeoutMs: 5_000, deadlineAt: Math.min(deadlineAt, Date.now() + 5_000) },
      );
      const seen = new Set(pool.map((p) => canonKey(p.title, p.artist)));
      for (const g of gathered) {
        for (const c of parseCandidates(g)) {
          const k = canonKey(c.title, c.artist);
          if (seen.has(k)) continue;
          seen.add(k);
          candidates.push(c);
        }
      }
      candidates = candidates.slice(0, 30);
    } catch {
      /* the gather is optional */
    }
  }
  const user =
    `Listener context (JSON):\n${ctxJson}\n\nPOOL — real songs, guaranteed playable (JSON):\n${JSON.stringify(pool)}\n\n` +
    (maxDiscover > 0 ? `${DISCOVERY_BRIEF(maxDiscover)}\n` + (candidates.length ? `SUPPLEMENTARY CANDIDATES from a music expert — real songs, use them as discoveries only when they fit (JSON):\n${JSON.stringify(candidates)}\n` : '') + '\n' : '') +
    `Return exactly ${Math.min(count, pool.length + maxDiscover)} songs, sequenced as a set. varietySeed: "${seed}" — a fresh round must differ from the last one for the same seed. ` +
    `styleAngle: "${angle}" — let it colour one or two picks. Opening feel: ${opener}. ` +
    (wantSegues ? '' : 'Segues are NOT needed this round: set every "segue" to "". ') +
    'JSON only.';
  const r = await chat(
    env,
    [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: user },
    ],
    // Live tail 2026-09-16: the NVIDIA dj engine answers a set in 8–13 s and
    // times out about half the time; its same-host secondary then burns
    // another 11 s. The Groq scholar lane answers the same JSON in 1–3 s, so
    // it leads, the dj engine is the first failover, and the secondary is
    // skipped — a set lands in a few seconds instead of a 408 at 26 s.
    { temperature: 0.8, lane: 'scholar', json: true, maxTokens: wantSegues ? 1500 : 1000, reasoningEffort: 'low', timeoutMs: 11_000, firstTimeoutMs: 8_000, skipSecondary: true, ladder: ['dj', 'fast', 'chat', 'home'], deadlineAt },
  );
  // Structural anti-repeat for proposals: whatever the model claims, a title
  // the listener just heard or was already offered never comes back.
  const avoidBlob = maxDiscover > 0 ? (JSON.stringify(ctx.avoidSongs ?? '') + JSON.stringify(ctx.recentlyPlayed ?? '') + JSON.stringify(ctx.skippedSongs ?? '')).toLowerCase() : '';
  const { intro, songs } = r.error ? { intro: '', songs: [] as DjPick[] } : parsePicks(r.content, pool, count, maxDiscover, avoidBlob);
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

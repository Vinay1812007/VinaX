/**
 * AI DJ — NVIDIA NIM (OpenAI-compatible) queue / next-song suggestions.
 *
 * The NVIDIA key lives ONLY server-side (VINAX_CHATGPT_120_B, a Cloudflare secret).
 * The client POSTs the listener's context; we ask the model for a flowing list
 * of { title, artist, reason } picks; the client resolves them to playable
 * tracks. If no key is set we return 503 and the client stays fully local.
 * See functions/_lib/ai.ts for env vars.
 */
import { chat, gather, extractJson, logAiEvent, type AiEnv } from '../_lib/ai';
import { methodNotAllowed, rateLimit } from '../_lib/ratelimit';
import { type DbEnv } from '../_lib/db';
import { varietySeed, styleAngle } from '../_lib/variety';

const SYSTEM_PROMPT = `You are the AI DJ of VinaX, a free music app for Indian music (Telugu, Hindi, Tamil and nine more languages). Think of yourself as a professional radio programmer with a musicologist's ear: tempo, key feel, vocal texture, instrumentation and era all register, and the next stretch of the queue gets built the way a live DJ reads a room. Work ONLY from the context you are handed — no invented listener history, and no claims about any streaming service's private algorithms or data. If anyone asks, VinaX built you; no AI vendor or model is ever named.
The goal every round: a continuation that feels natural, personal and alive, flowing straight out of the song playing now.

THE CONTEXT (fields may be absent — adapt): seedSong and currentLanguage describe the song playing now; sessionVibe and timeOfDay set the room. recentlyPlayed lists what just played. recentlyCompleted is a STRONG positive signal — those artists and styles are landing. skippedSongs are misses; steer clear of them and their close cousins. avoidSongs are your own recent recommendations — repeating ANY of them is forbidden; every round brings different tracks. likedSongs and topSongs (their most-played — the single strongest signal of love; anchor here) plus preferredArtists, topArtists, topLanguages and preferredLanguages describe taste. avoidLanguages and avoidArtists are hard bans. personalizationIntensity says how tightly to hug their history.

HOW A PROFESSIONAL BUILDS THIS QUEUE
1. The seed rules the vibe: stay in its tempo neighborhood, keep its emotional key (minor-key longing stays minor-key), and carry at least one musical thread — voice, instrumentation or groove — across every hand-off. No abrupt genre or energy jumps, ever.
2. Weight what the listener completes and replays; artists and styles that recur in their history recur in your picks, with topSongs as the anchor.
3. Nothing they skip, nothing in avoidLanguages, no artist in avoidArtists.
4. Variety is non-negotiable: an artist never appears twice in a row, and nothing from recentlyPlayed, avoidSongs or earlier in this queue comes back — a varietySeed rides every request, so the SAME seed MUST yield a different set on every round, not just on a different day; rotate artists, eras and deep cuts each time.
5. Mostly familiar, a little discovery — fresh without being jarring. A provided discoveryFocus gets extra weight THIS round, inside the language rule.
6. Score candidates internally 0-100 — vibe match 25, taste match 25, genre/style 15, mood+energy 15, language 10, freshness 5, repeat-avoidance 5 — and return the top scorers, breaking ties on transition quality (tempo, key feel, instrumentation continuity).
7. Mirror the seed's mood exactly: sad stays sad, party stays party, slow stays slow, romantic stays romantic. Blend eras — roughly 40% recent releases (last 2 years), 35% modern favourites, 25% timeless classics of the same scene, tilted by their history, sessionVibe and discoveryFocus — never a single-era wall.
8. Sequence an ARC, not a pile: settle into the seed's mood, build gently, allow one peak, then ease down. No sawtoothing between extremes.
9. Rotate voices like a music director: no lead singer or composer twice in a row even under different credited artists, and alternate vocal textures (male / female / duet) when the pool allows.

LANGUAGE RULE (above everything): currentLanguage is the queue's language — at least 11 of every 12 picks in it (currentLanguage "telugu" means Telugu songs, never Hindi or English). preferredLanguages applies only when currentLanguage is empty.
REAL SONGS ONLY: every pick exists on streaming services as a real, well-known song. No invented titles — and never dialogues, BGM cuts, jukebox strips, trailers, teasers or ringtones. A single fake or junk pick breaks the whole queue.

Respond with a JSON object of EXACTLY this shape and nothing else:
{"songs":[{"title":"Song name","artist":"Artist name","reason":"why it fits and how it flows, max 12 words"}]}
with the requested number of songs. Each "reason" reads like a DJ's segue note — short, specific, musical, naming the thread that carries over (mood, tempo, voice, instrument).`;

const CANDIDATE_PROMPT = `You feed VinaX's AI DJ its raw material: given the seed song now playing plus the listener's taste and session, pour out a wide pool of REAL, well-known songs that could plausibly come next.
NON-NEGOTIABLE: every title + artist pair must be a real, findable, reasonably popular track on major streaming catalogs — recognizable hits over obscure deep cuts (an unresolvable pick ruins the queue), and never an invented song, a dialogue track, BGM or a jukebox strip.
Crate-dig with intent: stay in the seed's currentLanguage unless it is empty, and in its tempo and mood neighborhood; range across many different well-known artists, composers and lead singers; blend eras around the seed's vibe. Lean toward preferredArtists, topArtists, preferredLanguages and topLanguages; never touch avoidLanguages or any artist in avoidArtists; skip everything in recentlyPlayed and avoidSongs.
Return ONLY JSON: {"candidates":[{"title":"...","artist":"..."}]} with about 30 songs. No commentary.`;

const CORS_HEADERS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'content-type, x-vinax-client',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...CORS_HEADERS },
  });
}

export const onRequestOptions = async (): Promise<Response> =>
  new Response(null, { status: 204, headers: CORS_HEADERS });

function parseSongs(content: string | null): Array<{ title: string; artist: string; reason?: string }> {
  const parsed = extractJson<{ songs?: Array<{ title?: unknown; artist?: unknown; reason?: unknown }> }>(content);
  if (!parsed || !Array.isArray(parsed.songs)) return [];
  return parsed.songs
    .filter((s) => s && typeof s.title === 'string' && typeof s.artist === 'string')
    .map((s) => ({
      title: String(s.title),
      artist: String(s.artist),
      reason: typeof s.reason === 'string' ? s.reason.slice(0, 120) : undefined,
    }))
    .slice(0, 20);
}

function parseCandidates(content: string | null): Array<{ title: string; artist: string }> {
  const parsed = extractJson<{ candidates?: Array<{ title?: unknown; artist?: unknown }> }>(content);
  const list = parsed && Array.isArray(parsed.candidates) ? parsed.candidates : [];
  return list
    .filter((s) => s && typeof s.title === 'string' && typeof s.artist === 'string')
    .map((s) => ({ title: String(s.title), artist: String(s.artist) }))
    .slice(0, 40);
}

/** POST-only: answer GET with an honest 405 instead of the SPA shell (DQA-07). */
export const onRequestGet = async (): Promise<Response> => methodNotAllowed();

export const onRequestPost = async (context: {
  request: Request;
  env: AiEnv & DbEnv;
  waitUntil?: (p: Promise<unknown>) => void;
}): Promise<Response> => {
  try {
    return await handlePost(context);
  } catch (e) {
    // Audit finding L-SRV.
    console.warn('[dj] unhandled exception:', e instanceof Error ? `${e.name}: ${e.message}` : String(e));
    return json({ error: 'internal' }, 500);
  }
};

async function handlePost(context: {
  request: Request;
  env: AiEnv & DbEnv;
  waitUntil?: (p: Promise<unknown>) => void;
}): Promise<Response> {
  const { request, env } = context;
  const isApp = request.headers.get('x-vinax-client') === 'app';
  const limited = await rateLimit(request, 'dj', { capacity: 15, refillPerMinute: 8 });
  if (limited) return limited;

  let body: { context?: Record<string, unknown> };
  try {
    body = (await request.json()) as { context?: Record<string, unknown> };
  } catch {
    return json({ error: 'bad_request' }, 400);
  }

  const reqCtx = (body.context ?? {}) as Record<string, unknown>;
  // An empty context can't be curated — refuse cheaply instead of running the
  // full model pipeline on {} (DQA-05).
  if (Object.keys(reqCtx).length === 0) return json({ error: 'empty_context' }, 400);
  const ctxJson = JSON.stringify(reqCtx, null, 2);
  // Per-request variety seed (nonce + IST date-hour): rides the candidate gather
  // AND the curate prompt so two consecutive "Play"/radio starts from the same
  // seed build substantially different queues (v3.6.0 — same pattern as the AI
  // Playlist v3.3.1; replaces the old bare Math.random() nonce).
  const seed = varietySeed();
  // Rotating creative angle — nudges the model into a genuinely different
  // corner of the taste on each round even when the seed and taste stay
  // identical (v3.7.1). Not user-visible, colours 1-3 picks in the queue.
  const angle = styleAngle(seed);
  const t0 = Date.now();
  // Aggregate wall-clock budget: whatever the upstream weather, answer (or
  // hand back the best pool so far) well before clients hang up (DQA-02).
  // 31s (2026-07-18, v3.2.0): a cold pinned engine measured 27.5s wall —
  // inside the old 28s budget by only 0.5s, one hiccup from a cut-off. The
  // client leash widened to 35s in the same pass, so a cold pinned engine
  // plus one full laddered generation still fit under client patience.
  const deadlineAt = t0 + 31_000;

  // Gather (parallel) — the fast lane (VinaX 20B, quick tasks) expands the pool
  // with well-known songs; merged with the client's real catalogPool for grounding.
  const poolSize = Array.isArray((reqCtx as { catalogPool?: unknown[] }).catalogPool)
    ? ((reqCtx as { catalogPool?: unknown[] }).catalogPool as unknown[]).length
    : 0;
  let candidates: Array<{ title: string; artist: string }> = [];
  // The catalog pool is real and instantly playable — when it's rich enough,
  // the AI gather round adds latency, not quality. Go straight to curation.
  if (poolSize < 24) try {
    const gathered = await gather(
      env,
      [
        { role: 'system', content: CANDIDATE_PROMPT },
        { role: 'user', content: 'Seed + session context (JSON):\n' + ctxJson + `\n\nvarietySeed: "${seed}" — treat this as a shuffle seed and vary the pool between rounds.\nstyleAngle: "${angle}" — colour a handful of candidates in this direction.\n\nList about 30 candidate songs as JSON.` },
      ],
      ['fast'],
      { temperature: 0.7, maxTokens: 1500, timeoutMs: 6_000, deadlineAt: Math.min(deadlineAt, Date.now() + 6_000) },
    );
    const seen = new Set<string>();
    for (const g of gathered) {
      for (const c of parseCandidates(g)) {
        const k = (c.title + '|' + c.artist).toLowerCase();
        if (!seen.has(k)) {
          seen.add(k);
          candidates.push(c);
        }
      }
    }
    candidates = candidates.slice(0, 50);
  } catch {
    /* gather is optional — the curator can work from the catalog/seed alone */
  }

  // Stage 2 — the DJ lane (VinaX 120B): deeply rank + sequence into a smooth queue.
  const rankInstr =
    'Build the next stretch of this listener\'s queue. Context (JSON):\n' +
    ctxJson +
    '\n\nThe context carries "catalogPool" — REAL songs from the listener\'s catalog, guaranteed playable. Select and sequence from catalogPool FIRST; the supplementary CANDIDATE POOL below exists only to fill gaps when catalogPool runs small:\n' +
    (candidates.length ? JSON.stringify(candidates) : '[]') +
    '\n\nReturn EXACTLY 20 songs sequenced like a professional set: settle into the seed\'s mood, build gently, let one peak land around two-thirds in, then ease off — a deliberate energy arc, every hand-off a musical segue, no abrupt jumps. Strong artist diversity (never the same artist twice in a row), a natural mix of new and classic, and a few high-fit discoveries. Favor catalogPool entries; every pick MUST be a real, existing song — invented titles are forbidden. If the context includes a "tuneInstruction", it is the HIGHEST-PRIORITY adjustment for this queue. Stay in currentLanguage unless it is empty. JSON only, each song with a short reason.' +
    '\n\nvarietySeed: "' +
    seed +
    '" — treat this as your shuffle seed. This is a FRESH round: two consecutive queues built for the same seed MUST differ substantially (rotate artists, eras and deep cuts), and any pick you have already made for this seed does not come back (see avoidSongs / recentlyPlayed).' +
    `\nstyleAngle: "${angle}" — let this colour 1-3 picks in the queue (not all of them; the queue still hugs the seed's mood).`;
  const r = await chat(
    env,
    [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: rankInstr },
    ],
    // 8s pinned-lane shot: the DJ engine (the proven fast JSON generator) gets
    // a fair try every call, while a cold pod still leaves the failover ladder
    // enough budget for a full answer. Failover favors fast JSON generators —
    // a slow reasoning fallback can't finish a 20-song queue in the leftover
    // budget, so the deep reasoning lane is deliberately NOT on this ladder.
    { temperature: 0.9, lane: 'dj', json: true, maxTokens: 1600, reasoningEffort: 'low', timeoutMs: 13_000, firstTimeoutMs: 8_000, ladder: ['home', 'chat', 'fast', 'scholar'], deadlineAt },
  );
  let songs = r.error ? [] : parseSongs(r.content);

  // HARD anti-repeat: whatever the model claims, never return a song the
  // client already surfaced or played recently (prompt obedience not assumed).
  const avoidBlob = (
    JSON.stringify((reqCtx as { avoidSongs?: unknown }).avoidSongs ?? '') +
    JSON.stringify((reqCtx as { recentlyPlayed?: unknown }).recentlyPlayed ?? '')
  ).toLowerCase();
  if (avoidBlob.length > 8) {
    const fresh = songs.filter((s) => s.title.length < 4 || !avoidBlob.includes(s.title.toLowerCase()));
    if (fresh.length >= 8) songs = fresh;
  }
  // Fallback: if deep ranking yields nothing, hand back the raw candidate pool.
  if (!songs.length && candidates.length) {
    songs = candidates.slice(0, 20).map((c) => ({ title: c.title, artist: c.artist }));
  }
  if (r.error !== 'not_configured') {
    const log = logAiEvent(env, {
      feature: 'dj',
      model: r.model ? `${r.model} @${r.keyRole ?? '?'}` : null,
      ok: songs.length > 0,
      status: r.status ?? null,
      error: r.error ?? (songs.length ? null : 'empty'),
      client: isApp ? 'app' : 'web',
      latency_ms: Date.now() - t0,
    });
    if (typeof context.waitUntil === 'function') context.waitUntil(log);
  }
  if (r.error === 'not_configured') return json({ error: 'ai_not_configured' }, 503);
  // 500, not 502: Cloudflare swallows origin 502 bodies (serves its own error
  // page) — 500 keeps the honest JSON envelope visible to clients (DQA-02).
  if (!songs.length) return json({ error: r.error ?? 'empty', status: r.status }, 500);
  return json({ songs, model: r.model });
}

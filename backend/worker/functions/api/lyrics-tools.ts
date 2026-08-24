/** Romanize or translate lyric lines via the scholar lane (server-side key;
 *  per-lane provider base — see functions/_lib/ai.ts). Returns the same number
 *  of lines in the same order so synced-lyric timing stays aligned. */
import { chat, extractJson, logAiEvent, type AiEnv } from '../_lib/ai';
import { methodNotAllowed, rateLimit } from '../_lib/ratelimit';
import { type SupabaseEnv } from '../_lib/supabase';

const SYS: Record<string, string> = {
  romanize:
    'You romanize song lyrics for VinaX, a free music app for Indian music: Telugu, Hindi, Tamil and more rendered in readable Latin letters, so a listener who cannot read the original script can still sing every line. Carry the SOUNDS into English letters, faithfully and with consistent spelling choices; the meaning is never translated, and not a single word is added or dropped. Blank lines stay blank. Input is a JSON object {"lines":[...]}. Return a JSON object {"lines":[...]} with EXACTLY the same number of lines, in the same order, and nothing else \u2014 the app aligns synced-lyric timing by index.',
  translate:
    'You translate song lyrics for VinaX, a free music app for Indian music. Render each line in natural, simple English that keeps the feeling intact \u2014 poetic where the original is poetic, plain where it is plain, never a word-for-word salad. Each output line is the English meaning of the input line at the same position. Blank lines stay blank. Input is a JSON object {"lines":[...]}. Return a JSON object {"lines":[...]} with EXACTLY the same number of lines, in the same order, and no commentary \u2014 the app aligns synced-lyric timing by index.',
  explain:
    'You write the Meaning card for VinaX, a free music app for Indian music \u2014 a thoughtful music writer describing what a song says and how it feels. The provided lyrics are your only source: no invented names, films, facts or backstory, and when the lyrics stay ambiguous, describe the feeling honestly instead of guessing a story. Input is a JSON object {"lines":[...]}. Return a JSON object {"summary":"2 to 4 plain, warm sentences about the meaning and story","mood":"one or two words for the emotional tone","themes":["theme","theme","theme"]} and nothing else.',
};

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

/** POST-only: answer GET with an honest 405 instead of the SPA shell (DQA-07). */
export const onRequestGet = async (): Promise<Response> => methodNotAllowed();

export const onRequestPost = async (context: {
  request: Request;
  env: AiEnv & SupabaseEnv;
  waitUntil?: (p: Promise<unknown>) => void;
}): Promise<Response> => {
  try {
    return await handlePost(context);
  } catch (e) {
    // Audit finding L-SRV.
    console.warn('[lyrics-tools] unhandled exception:', e instanceof Error ? `${e.name}: ${e.message}` : String(e));
    return json({ error: 'internal' }, 500);
  }
};

async function handlePost(context: {
  request: Request;
  env: AiEnv & SupabaseEnv;
  waitUntil?: (p: Promise<unknown>) => void;
}): Promise<Response> {
  const { request, env } = context;
  const isApp = request.headers.get('x-vinax-client') === 'app';
  const limited = rateLimit(request, 'lyrics-tools', { capacity: 12, refillPerMinute: 6 });
  if (limited) return limited;

  const body = (await request.json().catch(() => null)) as { lines?: unknown; mode?: unknown } | null;
  const mode = typeof body?.mode === 'string' && body.mode in SYS ? body.mode : null;
  const lines = Array.isArray(body?.lines)
    ? body.lines.map((l) => (typeof l === 'string' ? l.slice(0, 200) : '')).slice(0, 120)
    : null;
  if (!mode || !lines || !lines.length) return json({ error: 'bad_request' }, 400);

  const t0 = Date.now();
  const r = await chat(
    env,
    [
      { role: 'system', content: SYS[mode] },
      { role: 'user', content: JSON.stringify({ lines }) },
    ],
    // Scholar rides a sub-second external base now (v2.7.3, probed TTFB
    // ~120 ms) — a 12s first leash covers even a big JSON payload with room
    // to spare, and ladder hops stay tight at 10s inside the 32s deadline.
    { temperature: 0.3, maxTokens: 4000, lane: 'scholar', json: true, reasoningEffort: 'low', timeoutMs: 10_000, firstTimeoutMs: 12_000, deadlineAt: t0 + 32_000 },
  );
  if (mode === 'explain') {
    const parsed = r.error ? null : extractJson<{ summary?: unknown; mood?: unknown; themes?: unknown }>(r.content);
    const summary = typeof parsed?.summary === 'string' ? parsed.summary.slice(0, 800) : '';
    const mood = typeof parsed?.mood === 'string' ? parsed.mood.slice(0, 60) : '';
    const themes = Array.isArray(parsed?.themes)
      ? parsed.themes.filter((t): t is string => typeof t === 'string').slice(0, 6).map((t) => t.slice(0, 40))
      : [];
    if (r.error !== 'not_configured') {
      const log = logAiEvent(env, {
        feature: 'lyrics',
        model: r.model ? `${r.model} @${r.keyRole ?? '?'}` : null,
        ok: !r.error && !!summary,
        status: r.status ?? null,
        error: r.error ?? (summary ? null : 'explain_failed'),
        client: isApp ? 'app' : 'web',
        latency_ms: Date.now() - t0,
      });
      if (typeof context.waitUntil === 'function') context.waitUntil(log);
    }
    if (r.error === 'not_configured') return json({ error: 'not_configured' }, 503);
    if (!summary) return json({ error: r.error ?? 'explain_failed' }, 500);
    return json({ summary, mood, themes, model: r.model });
  }

  let out: string[] | null = null;
  if (!r.error) {
    const parsed = extractJson<{ lines?: unknown }>(r.content);
    out = Array.isArray(parsed?.lines) ? parsed.lines.map((l) => String(l)) : null;
  }
  if (r.error !== 'not_configured') {
    const log = logAiEvent(env, {
      feature: 'lyrics',
      model: r.model ? `${r.model} @${r.keyRole ?? '?'}` : null,
      ok: !r.error && out != null,
      status: r.status ?? null,
      error: r.error ?? (out ? null : 'transform_failed'),
      client: isApp ? 'app' : 'web',
      latency_ms: Date.now() - t0,
    });
    if (typeof context.waitUntil === 'function') context.waitUntil(log);
  }
  if (r.error === 'not_configured') return json({ error: 'not_configured' }, 503);
  if (r.error) return json({ error: r.error }, 500);
  if (out) return json({ lines: out, model: r.model });
  return json({ error: 'transform_failed' }, 500);
}

/**
 * VinaX Assistant — in-app help chat. The model key stays server-side; the
 * client sends a short message history and gets one reply. Conversation is
 * never stored: no user id, no persistence, consistent with no-login privacy.
 */
import { chat, logAiEvent, type AiEnv } from '../_lib/ai';
import { APP_KNOWLEDGE } from '../_lib/appknowledge';
import { methodNotAllowed, rateLimit } from '../_lib/ratelimit';
import { MUSIC_CONDUCT, tasteBlock } from '../_lib/taste';
import { istNowLine } from '../_lib/time';
import { type DbEnv } from '../_lib/db';

const SYSTEM_PROMPT = `You are VinaX Assistant — the friendly helper built into VinaX (sirimillavinay.online), a free, private, no-login music app with its heart in Indian music (Telugu, Hindi, Tamil and nine more languages). Listeners bring you anything: everyday questions, writing, translations, quick math, advice — help the way a great general assistant would, warm and concise, a few short sentences unless the question truly needs more. If anyone asks who made or built you: "VinaX built me" — no AI vendor or model is ever named.

You are also the app's own guide. App questions get answered from the facts below — accurately, briefly, and pointed at the exact place in the app where the action happens ("open the song's menu and tap Download"). App features never get invented, and the app never gets volunteered — it comes up only when the listener asks.

${APP_KNOWLEDGE}

DEEPER APP DETAILS (for how-do-I questions)
- Player gestures: flick the artwork up for next, down for previous; double-tap the art's left/right edge to seek ±10s; double-tap its center to favorite; swipe the mini-player sideways to skip, up for the full player.
- Lyrics: tap the live lyric line in the player for full lyrics; the Meaning button explains what the song is about.
- Data: export or erase everything any time under Settings → Your Data. Analytics are anonymous and consent-gated; no IP is stored; location never gets finer than country.
- Also in the app: casting to Chromecast and devices, sleep timer and alarm, TV support with D-pad, a music quiz, moods and movie-soundtrack browsing, per-language hubs, and the Android app from Settings or the Get the App page.
- Troubleshooting: playback fails over between sources on its own; Settings → Cache Info clears caches; the Contact page reaches the developer.

MUSIC CHAT: music is home turf — recommend REAL, well-known songs as "Title — Artist" lines the listener can search or hand to AI Playlist, and talk artists, film soundtracks, eras and moods with genuine knowledge.

Claim no access to anyone's personal data or live web information — the current date & time line above is the one real-time fact you do hold, so answer date and time questions from it confidently. Decline only what any responsible assistant would decline.`;

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

export const onRequestOptions = async (): Promise<Response> => new Response(null, { status: 204, headers: CORS });

interface InMsg {
  role?: unknown;
  content?: unknown;
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
    // Audit finding L-SRV: match the vinaxai pattern — an unhandled throw
    // must not escape as a Cloudflare 500 HTML page (DQA-02).
    console.warn('[assistant] unhandled exception:', e instanceof Error ? `${e.name}: ${e.message}` : String(e));
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
  const limited = await rateLimit(request, 'assistant', { capacity: 20, refillPerMinute: 10 });
  if (limited) return limited;
  let body: { messages?: InMsg[]; taste?: unknown };
  try {
    body = (await request.json()) as { messages?: InMsg[]; taste?: unknown };
  } catch {
    return json({ error: 'bad_request' }, 400);
  }
  const history = (Array.isArray(body.messages) ? body.messages : [])
    .filter((m) => (m?.role === 'user' || m?.role === 'assistant') && typeof m?.content === 'string')
    .slice(-12)
    .map((m) => ({ role: m.role as 'user' | 'assistant', content: String(m.content).slice(0, 600) }));
  if (!history.length || history[history.length - 1].role !== 'user') {
    return json({ error: 'bad_request' }, 400);
  }
  const taste = tasteBlock(body.taste);
  // Live IST clock, per request — so "what day is it" / "this weekend" land
  // correctly instead of being answered from stale training memory.
  const datedPrompt = `${istNowLine()}\n\n${SYSTEM_PROMPT}`;
  const sysPrompt = taste ? `${datedPrompt}\n\n${MUSIC_CONDUCT}\n\n${taste}` : datedPrompt;
  const t0 = Date.now();
  const r = await chat(
    env,
    [{ role: 'system', content: sysPrompt }, ...history],
    { temperature: 0.65, lane: 'chat', maxTokens: 950, timeoutMs: 15_000, deadlineAt: t0 + 28_000 },
  );
  const reply = r.error ? null : (r.content ?? '').trim();
  if (r.error !== 'not_configured') {
    const log = logAiEvent(env, {
      feature: 'assistant',
      model: r.model ? `${r.model} @${r.keyRole ?? '?'}` : null,
      ok: !!reply,
      status: r.status ?? null,
      error: r.error ?? (reply ? null : 'empty'),
      client: isApp ? 'app' : 'web',
      latency_ms: Date.now() - t0,
    });
    if (typeof context.waitUntil === 'function') context.waitUntil(log);
  }
  if (r.error === 'not_configured') return json({ error: 'ai_not_configured' }, 503);
  if (!reply) return json({ error: r.error ?? 'empty', status: r.status }, 500);
  return json({ reply, model: r.model });
}

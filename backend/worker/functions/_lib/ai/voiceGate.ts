/**
 * VinaX AI — the checks every voice route runs first, in this order: the
 * per-address bucket, a session, the account's RATE_LIMIT_10 tier (voice
 * calls are the costly ones), a provider key for this feature, and the
 * owner's switch (or the tester list).
 */
import { bearer, readSession } from '../googleAuth';
import { CORS, json } from '../authShared';
import { bindingAllows, rateLimitAsync } from '../ratelimit';
import { dbConfigured } from '../db';
import { aiOpenFor, aiSettings } from './config';
import { voiceAvailability, type VoiceAvailability } from './voice';
import type { AiEnv } from './types';

export type Gate = { ok: true; sub: string } | { ok: false; res: Response };

export const rateLimited = (): Response => new Response(JSON.stringify({ error: 'rate_limited', retryAfter: 60 }), {
  status: 429,
  headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'retry-after': '60', ...CORS },
});

export async function voiceGate(request: Request, env: AiEnv, route: string, feature: keyof VoiceAvailability, bucket = { capacity: 12, refillPerMinute: 10 }): Promise<Gate> {
  const limited = await rateLimitAsync(request, route, bucket, env);
  if (limited) return { ok: false, res: limited };
  const sub = await readSession(env, bearer(request));
  if (!sub) return { ok: false, res: json({ error: 'signed_out' }, 401) };
  if ((await bindingAllows(env, 'RATE_LIMIT_10', `${route}|account|${sub}`)) === false) return { ok: false, res: rateLimited() };
  if (!voiceAvailability(env)[feature]) return { ok: false, res: json({ error: 'ai_not_configured' }, 503) };
  if (!dbConfigured(env)) return { ok: false, res: json({ error: 'unavailable' }, 503) };
  if (!aiOpenFor(await aiSettings(env), sub)) return { ok: false, res: json({ error: 'ai_disabled' }, 503) };
  return { ok: true, sub };
}

/**
 * What a failed voice call answers (never the provider's own words): busy
 * when every engine was resting or out of allowance, else unavailable.
 */
export function voiceFailure(kinds: string[]): Response {
  const busy = kinds.every((k) => k === 'rate' || k === 'quota');
  return busy ? json({ error: 'voice_busy' }, 429) : json({ error: 'voice_unavailable' }, 503);
}

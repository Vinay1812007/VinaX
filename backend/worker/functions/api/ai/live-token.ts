/**
 * VinaX AI — POST /api/ai/live-token: a one-use, short-lived token for one
 * Live voice session. The page opens Gemini Live's WebSocket with it; the
 * Gemini key never leaves the Worker.
 *
 *   { thinking?: boolean,        // Extended thinking on: the thinking Live model first
 *     skip?: ["<live model id>"],// models that just failed to connect (the page asks again)
 *     voice?: "<Gemini voice>", timezone?, locale? }
 *
 *   → 200 { token, url, setup, model: { id, name }, expiresAt }
 *         `setup` is the first message the page sends on the socket; the
 *         token is locked to it where Google allows that.
 *   → 401 signed_out · 429 rate_limited | voice_busy
 *   → 503 ai_not_configured | ai_disabled | unavailable | voice_unavailable
 */
import { CORS, accountOf, json } from '../../_lib/authShared';
import { readJsonCapped } from '../../_lib/body';
import { voiceFailure, voiceGate } from '../../_lib/ai/voiceGate';
import {
  DEFAULT_LIVE_VOICE, LIVE_MODELS, LIVE_THINKING_MODEL, LIVE_VOICES, LIVE_WS_URL, liveSetup, mintLiveToken, noteVoiceFailure, voiceResting,
} from '../../_lib/ai/voice';
import { firstNameOf, safeLocale, safeTimezone, voicePrompt } from '../../_lib/ai/prompt';
import { asProviderError } from '../../_lib/ai/errors';
import type { AiEnv } from '../../_lib/ai/types';

export const onRequestOptions = async (): Promise<Response> => new Response(null, { status: 204, headers: { ...CORS, 'access-control-allow-methods': 'POST, OPTIONS' } });

/** The Live models to offer, in order, without the ones the page says failed. */
export function liveCandidates(thinking: boolean, skip: readonly string[], now = Date.now()): Array<{ id: string; name: string }> {
  const all = thinking ? [LIVE_THINKING_MODEL, ...LIVE_MODELS] : [...LIVE_MODELS];
  return all.filter((m) => !skip.includes(m.id) && !voiceResting(m.id, now));
}

export const onRequestPost = async (ctx: { request: Request; env: AiEnv }): Promise<Response> => {
  const { request, env } = ctx;
  const gate = await voiceGate(request, env, 'ai-live-token', 'live');
  if (!gate.ok) return gate.res;
  const read = await readJsonCapped<Record<string, unknown> | null>(request, 8 * 1024);
  if (!read.ok) return json({ error: 'bad_request' }, 400);
  const body = read.value && typeof read.value === 'object' ? read.value : {};
  const skip = Array.isArray(body.skip) ? body.skip.filter((s): s is string => typeof s === 'string').slice(0, 10) : [];
  const voice = (LIVE_VOICES as readonly string[]).includes(body.voice as string) ? (body.voice as string) : DEFAULT_LIVE_VOICE;
  const candidates = liveCandidates(body.thinking === true, skip);
  if (!candidates.length) return voiceFailure([]);

  const account = await accountOf(env, gate.sub);
  const kinds: string[] = [];
  for (const model of candidates) {
    const prompt = voicePrompt({
      now: new Date(),
      timezone: safeTimezone(body.timezone),
      locale: safeLocale(body.locale),
      firstName: firstNameOf(account.ok ? account.value?.name : null),
      modelName: model.name,
      providerName: 'Google',
    });
    const setup = liveSetup(model.id, voice, prompt);
    try {
      const t = await mintLiveToken(env, setup);
      console.log(JSON.stringify({ route: 'ai-live-token', provider: 'gemini', model: model.id, shape: t.shape, ok: true }));
      return json({ token: t.token, url: LIVE_WS_URL, setup, model, expiresAt: t.expiresAt });
    } catch (e) {
      const err = asProviderError(e);
      kinds.push(err.kind);
      noteVoiceFailure(model.id, err);
      console.log(JSON.stringify({ route: 'ai-live-token', provider: 'gemini', model: model.id, ok: false, kind: err.kind, status: err.status }));
      // A refused key or spent allowance is the same for every Live model.
      if (err.kind === 'auth' || err.kind === 'quota' || err.kind === 'not_configured') break;
    }
  }
  return voiceFailure(kinds);
};

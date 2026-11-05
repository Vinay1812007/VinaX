/**
 * VinaX AI — POST /api/ai/live-token: a one-use, short-lived token for one
 * Live voice session. The page opens Gemini Live's WebSocket with it; the
 * Gemini key never leaves the Worker.
 *
 *   { thinking?: boolean,        // Extended thinking on: the thinking Live model first
 *     model?: "<live model id>", // picked in VinaX AI settings: tried before the rest
 *     skip?: ["<live model id>"],// models that just failed to connect (the page asks again)
 *     search?: boolean,          // web search in Live voice (only when the owner allows search)
 *     recap?: [{ role, text }],  // what was said before a reconnect (the latest 20 turns are kept)
 *     context?: [{ role, text }],// the typed chat Live voice was opened from (the latest 12 turns are kept)
 *     language?: "auto" | "<code>", // hold replies to one language (prompt.ts LIVE_LANGUAGES)
 *     lean?: true,               // without the speed settings (the model refused them)
 *     personal?: { name?, about?, instructions?, style? }, // VinaX AI settings → Personalisation, never stored
 *     conversationId?, incognito?, // whose memory applies (none in an incognito chat)
 *     voice?: "<Gemini voice>", timezone?, locale? }
 *
 *   → 200 { token, url, setup, model: { id, name }, search, tuned, expiresAt }
 *         `setup` is the first message the page sends on the socket; the
 *         token is locked to it where Google allows that. `search` says
 *         whether the setup carries the search tool; `tuned` whether it
 *         carries the speed settings (quick end of turn, quick thinking).
 *   → 401 signed_out · 429 rate_limited | voice_busy
 *   → 503 ai_not_configured | ai_disabled | unavailable | voice_unavailable
 */
import { CORS, accountOf, json } from '../../_lib/authShared';
import { readJsonCapped } from '../../_lib/body';
import { voiceFailure, voiceGate } from '../../_lib/ai/voiceGate';
import { aiSettings } from '../../_lib/ai/config';
import {
  ALL_LIVE_MODELS, DEFAULT_LIVE_VOICE, LIVE_MODELS, LIVE_SEARCH_MODELS, LIVE_THINKING_MODEL, LIVE_VOICES, LIVE_WS_URL, liveSetup, mintLiveToken, noteVoiceFailure, voiceResting,
} from '../../_lib/ai/voice';
import { chatContextBlock, firstNameOf, languageReminder, ownerBlock, personalBlock, safeLocale, safeTimezone, sanitizePersonal, voicePrompt, voiceRecapBlock } from '../../_lib/ai/prompt';
import { memoryBlock, memoryFor } from '../../_lib/ai/memory';
import { asProviderError } from '../../_lib/ai/errors';
import type { AiEnv } from '../../_lib/ai/types';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const onRequestOptions = async (): Promise<Response> => new Response(null, { status: 204, headers: { ...CORS, 'access-control-allow-methods': 'POST, OPTIONS' } });

/**
 * The Live models to offer, in order, without the ones the page says failed:
 * the picked one first, then (with web search on) the models that can
 * search, then the thinking one when Extended thinking is on, then Auto's
 * order. Others stay behind as fallbacks.
 */
export function liveCandidates(thinking: boolean, skip: readonly string[], now = Date.now(), picked: unknown = null, search = false): Array<{ id: string; name: string }> {
  const first = ALL_LIVE_MODELS.find((m) => m.id === picked);
  const searchers = search ? LIVE_MODELS.filter((m) => LIVE_SEARCH_MODELS.includes(m.id)) : [];
  const all = [...(first ? [first] : []), ...searchers, ...(thinking ? [LIVE_THINKING_MODEL] : []), ...LIVE_MODELS];
  return all.filter((m, i) => all.findIndex((x) => x.id === m.id) === i && !skip.includes(m.id) && !voiceResting(m.id, now));
}

export const onRequestPost = async (ctx: { request: Request; env: AiEnv }): Promise<Response> => {
  const { request, env } = ctx;
  const gate = await voiceGate(request, env, 'ai-live-token', 'live');
  if (!gate.ok) return gate.res;
  const read = await readJsonCapped<Record<string, unknown> | null>(request, 32 * 1024);
  if (!read.ok) return json({ error: 'bad_request' }, 400);
  const body = read.value && typeof read.value === 'object' ? read.value : {};
  const skip = Array.isArray(body.skip) ? body.skip.filter((s): s is string => typeof s === 'string').slice(0, 10) : [];
  const voice = (LIVE_VOICES as readonly string[]).includes(body.voice as string) ? (body.voice as string) : DEFAULT_LIVE_VOICE;
  const settings = await aiSettings(env);
  // The owner's search switch covers Live voice too.
  const search = body.search === true && settings.search;
  const candidates = liveCandidates(body.thinking === true, skip, Date.now(), body.model, search);
  if (!candidates.length) return voiceFailure([]);
  const tuned = body.lean !== true;
  const personal = sanitizePersonal(body.personal);
  const conversationId = typeof body.conversationId === 'string' && UUID.test(body.conversationId) ? body.conversationId : null;
  const [account, memory] = await Promise.all([
    accountOf(env, gate.sub),
    memoryFor(env, gate.sub, conversationId, body.incognito === true).catch(() => null),
  ]);
  const accountName = firstNameOf(account.ok ? account.value?.name : null);
  // What the model is told besides the spoken prompt, in the chat's order:
  // the owner's instructions, the listener's preferences, memory, then the
  // typed chat and the call so far.
  const extra = [
    ownerBlock(settings.instructions),
    personalBlock(personal),
    memory ? memoryBlock(memory, '', { voice: true }) : null,
    chatContextBlock(body.context),
    voiceRecapBlock(body.recap),
    languageReminder(body.language),
  ].filter((b): b is string => !!b);

  const kinds: string[] = [];
  for (const model of candidates) {
    const spoken = voicePrompt({
      now: new Date(),
      timezone: safeTimezone(body.timezone),
      locale: safeLocale(body.locale),
      firstName: personal?.name || accountName,
      modelName: model.name,
      providerName: 'Google',
    }, search, body.language);
    const prompt = [spoken, ...extra].join('\n\n');
    const setup = liveSetup(model.id, voice, prompt, search, tuned);
    try {
      const t = await mintLiveToken(env, setup);
      console.log(JSON.stringify({ route: 'ai-live-token', provider: 'gemini', model: model.id, shape: t.shape, search, tuned, ok: true }));
      return json({ token: t.token, url: LIVE_WS_URL, setup, model, search, tuned, expiresAt: t.expiresAt });
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

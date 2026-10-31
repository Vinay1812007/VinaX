/**
 * VinaX AI — GET /api/ai/models: what the model picker offers.
 *
 *   → 200 { enabled, configured, search, groups: [...], models: [{ id, name, provider, group,
 *            description, flags: { vision, web, thinking, code }, available, reason? }],
 *            voice: { dictation, readAloud, live, voices: [...], liveVoices: [...], liveModels: [{ id, name }] } }
 *
 * `voice` says which voice features have a provider key (phase 6) and
 * which voices the page may offer for Read aloud and Live.
 *
 * Public (a session, when sent, only decides `enabled` for testers). It
 * never names upstream hosts or keys. `available` is false when the
 * provider's key is not set ('not_configured') or the model is resting
 * after a failure ('busy').
 */
import { bearer, readSession } from '../../_lib/googleAuth';
import { CORS, json } from '../../_lib/authShared';
import { rateLimitAsync } from '../../_lib/ratelimit';
import { dbConfigured } from '../../_lib/db';
import { anyProviderConfigured, PROVIDER_NAMES, providerConfigured } from '../../_lib/ai/adapters';
import { aiOpenFor, aiSettings, registryFor, sanitizeAiSettings } from '../../_lib/ai/config';
import { isCooling } from '../../_lib/ai/cooldown';
import { ladderModels, PICKER_GROUPS } from '../../_lib/ai/models';
import { searchConfigured } from '../../_lib/ai/search';
import { ALL_LIVE_MODELS, LIVE_VOICES, READ_VOICES, voiceAvailability } from '../../_lib/ai/voice';
import type { AiEnv } from '../../_lib/ai/types';

export const onRequestOptions = async (): Promise<Response> => new Response(null, { status: 204, headers: { ...CORS, 'access-control-allow-methods': 'GET, OPTIONS' } });

export const onRequestGet = async (ctx: { request: Request; env: AiEnv }): Promise<Response> => {
  const { request, env } = ctx;
  const limited = await rateLimitAsync(request, 'ai-models', { capacity: 30, refillPerMinute: 30 }, env);
  if (limited) return limited;
  const settings = dbConfigured(env) ? await aiSettings(env) : sanitizeAiSettings(null);
  const token = bearer(request);
  const sub = token ? await readSession(env, token) : null;
  const now = Date.now();
  const models = registryFor(settings)
    .filter((spec) => spec.group !== null)
    .map((spec) => {
      const configured = providerConfigured(env, spec.provider);
      const busy = configured && isCooling(spec, now);
      return {
        id: spec.id,
        name: spec.name,
        provider: PROVIDER_NAMES[spec.provider],
        group: spec.group,
        description: spec.description,
        flags: { vision: spec.flags.vision, web: spec.flags.grounding, thinking: spec.flags.reasoning, code: spec.group === 'code' },
        available: configured && !busy,
        ...(!configured ? { reason: 'not_configured' } : busy ? { reason: 'busy' } : {}),
      };
    });
  // Web search is offered when the owner allows it and something can search: the search API or free grounding.
  const registry = registryFor(settings);
  const canSearch = searchConfigured(env) || ladderModels(registry, 'grounded').some((spec) => providerConfigured(env, spec.provider));
  const voice = { ...voiceAvailability(env), voices: READ_VOICES, liveVoices: LIVE_VOICES, liveModels: ALL_LIVE_MODELS };
  return json({ enabled: aiOpenFor(settings, sub), configured: anyProviderConfigured(env), search: settings.search && canSearch, groups: PICKER_GROUPS, models, voice });
};

/**
 * VinaX AI — GET /api/ai/models: what the model picker offers.
 *
 *   → 200 { enabled, configured, groups: [...], models: [{ id, name, provider, group,
 *            description, flags: { vision, web, thinking, code }, available, reason? }] }
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
import { PICKER_GROUPS } from '../../_lib/ai/models';
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
  return json({ enabled: aiOpenFor(settings, sub), configured: anyProviderConfigured(env), groups: PICKER_GROUPS, models });
};

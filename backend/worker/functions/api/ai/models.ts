/**
 * VinaX AI — GET /api/ai/models: what the model picker offers.
 *
 *   → 200 { enabled, configured, search, groups: [...], models: [{ id, name, provider, group,
 *            description, flags: { vision, web, thinking, code, pdf }, available, reason?,
 *            thinkingLevels: ["fast" | "standard" | "extended" | "max"],   // levels with a real provider switch (thinking.ts)
 *            kinds: ["fast" | "reasoning" | "code" | "vision" | "long"],    // capability filters in the picker
 *            contextTokens, outputTokens, recommended? }],              // about: the registry's character limits / 4
 *            autoThinking: [...],   // the thinking levels Auto can give with the models in its ladders
 *            voice: { dictation, readAloud, live, liveSearch, voices: [...], liveVoices: [...], liveModels: [{ id, name }], liveLanguages: [{ code, name, native }] },
 *            limits: { imagesPerMessage, filesPerMessage, filesPerChat, pdfMB, pdfPages, textMB } }
 *
 * `voice` says which voice features have a provider key (phase 6) and
 * which voices the page may offer for Read aloud and Live. `liveSearch`:
 * Live voice may search the web (the owner's search switch; Live searches
 * with its own model, so it needs no search API key).
 *
 * Public (a session, when sent, only decides `enabled` for testers). It
 * never names upstream hosts or keys. `available` is false when the
 * provider's key is not set ('not_configured') or the model is resting
 * after a failure ('busy').
 *
 * The curated models come first, then the free models found in each
 * provider's own list (`more-<provider>` groups, _lib/ai/discovery.ts),
 * unless the owner set `discover: false`. A provider's list that fails
 * leaves the curated picker as it is.
 */
import { bearer, readSession } from '../../_lib/googleAuth';
import { CORS, json } from '../../_lib/authShared';
import { rateLimitAsync } from '../../_lib/ratelimit';
import { dbConfigured } from '../../_lib/db';
import { anyProviderConfigured, PROVIDER_NAMES, providerConfigured } from '../../_lib/ai/adapters';
import { aiOpenFor, aiSettings, pickerRegistryFor, registryFor, sanitizeAiSettings } from '../../_lib/ai/config';
import { isCooling } from '../../_lib/ai/cooldown';
import { LADDERS, ladderModels, PICKER_GROUPS } from '../../_lib/ai/models';
import { autoLevels, levelsOf } from '../../_lib/ai/thinking';
import type { ModelSpec } from '../../_lib/ai/types';
import { searchConfigured } from '../../_lib/ai/search';
import { ALL_LIVE_MODELS, LIVE_VOICES, READ_VOICES, voiceAvailability } from '../../_lib/ai/voice';
import type { AiEnv } from '../../_lib/ai/types';
import { LIVE_LANGUAGES } from '../../_lib/ai/prompt';

/** A model's capability filters, from its flags, group, limits and Auto's ladders. */
export function kindsOf(spec: ModelSpec): Array<'fast' | 'reasoning' | 'code' | 'vision' | 'long'> {
  const out: Array<'fast' | 'reasoning' | 'code' | 'vision' | 'long'> = [];
  if (spec.group === 'fast' || spec.tier === 'fast') out.push('fast');
  if (spec.flags.reasoning) out.push('reasoning');
  if (spec.group === 'code' || LADDERS.code.includes(spec.id)) out.push('code');
  if (spec.flags.vision) out.push('vision');
  if (spec.maxContextChars >= LONG_CONTEXT_CHARS) out.push('long');
  return out;
}

/** "Long context" in the picker: room for a long PDF or a whole codebase file set. */
export const LONG_CONTEXT_CHARS = 300_000;

/** Auto's first choices: the head of each chat ladder. */
export const recommendedIds = (): Set<string> => new Set((['default', 'code', 'deep', 'vision', 'fast'] as const).map((l) => LADDERS[l][0]).filter(Boolean));

export const onRequestOptions = async (): Promise<Response> => new Response(null, { status: 204, headers: { ...CORS, 'access-control-allow-methods': 'GET, OPTIONS' } });

export const onRequestGet = async (ctx: { request: Request; env: AiEnv; waitUntil?: (p: Promise<unknown>) => void }): Promise<Response> => {
  const { request, env } = ctx;
  const limited = await rateLimitAsync(request, 'ai-models', { capacity: 30, refillPerMinute: 30 }, env);
  if (limited) return limited;
  const settings = dbConfigured(env) ? await aiSettings(env) : sanitizeAiSettings(null);
  const token = bearer(request);
  const sub = token ? await readSession(env, token) : null;
  const now = Date.now();
  const picker = await pickerRegistryFor(env, settings, { waitUntil: ctx.waitUntil });
  const recommended = recommendedIds();
  const models = picker
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
        flags: { vision: spec.flags.vision, web: spec.flags.grounding, thinking: spec.flags.reasoning, code: spec.group === 'code', pdf: spec.flags.pdf },
        thinkingLevels: levelsOf(spec),
        kinds: kindsOf(spec),
        contextTokens: Math.round(spec.maxContextChars / 4),
        outputTokens: spec.maxOutput,
        ...(recommended.has(spec.id) ? { recommended: true } : {}),
        available: configured && !busy,
        ...(!configured ? { reason: 'not_configured' } : busy ? { reason: 'busy' } : {}),
      };
    });
  // Web search is offered when the owner allows it and something can search: the search API or free grounding.
  const registry = registryFor(settings);
  const canSearch = searchConfigured(env, settings.limits.searchesPerDay) || ladderModels(registry, 'grounded').some((spec) => providerConfigured(env, spec.provider));
  const avail = voiceAvailability(env);
  const voice = { ...avail, liveSearch: avail.live && settings.search, voices: READ_VOICES, liveVoices: LIVE_VOICES, liveModels: ALL_LIVE_MODELS, liveLanguages: LIVE_LANGUAGES };
  // The owner's file limits, so the page checks files against the same numbers (searchesPerDay and the rate stay server-side).
  const { imagesPerMessage, filesPerMessage, filesPerChat, pdfMB, pdfPages, textMB } = settings.limits;
  const limits = { imagesPerMessage, filesPerMessage, filesPerChat, pdfMB, pdfPages, textMB };
  const chatLadders = (['default', 'code', 'deep', 'vision', 'long', 'fast'] as const).flatMap((l) => ladderModels(registry, l)).filter((spec) => providerConfigured(env, spec.provider));
  return json({ enabled: aiOpenFor(settings, sub), configured: anyProviderConfigured(env), search: settings.search && canSearch, groups: PICKER_GROUPS, models, voice, limits, autoThinking: autoLevels(chatLadders) });
};

/**
 * The personal engine's switches and weights, from the `personal-config`
 * setting (written in the console's Settings page), sanitised so a bad value
 * can never break a page:
 *
 *   { enabled: true,                       // the whole engine; missing = on
 *     composer: true,                      // let the language model shape Home and playlists
 *     embedModel: "cloudflare:@cf/baai/bge-m3",
 *     weights: { tasteFit: 0.3, … } }     // each clamped to 0.5–2× its default
 */
import type { DbEnv } from '../db';
import { setting } from '../settings';

export interface PersonalWeights {
  tasteFit: number;
  artist: number;
  language: number;
  colisten: number;
  source: number;
  agreement: number;
  hour: number;
  freshness: number;
  community: number;
  exposure: number;
  skips: number;
  novelty: number;
}

export const PERSONAL_WEIGHT_DEFAULTS: Readonly<PersonalWeights> = {
  tasteFit: 0.3,
  artist: 0.22,
  language: 0.14,
  colisten: 0.14,
  source: 0.1,
  agreement: 0.08,
  hour: 0.06,
  freshness: 0.05,
  community: 0.04,
  exposure: 1,
  skips: 0.2,
  novelty: 0.1,
};

/** The one embedding space every row and every taste vector lives in unless the owner names another. */
export const DEFAULT_EMBED_MODEL = 'cloudflare:@cf/baai/bge-m3';
export const EMBED_DIMENSIONS = 1024;

export interface PersonalConfig {
  enabled: boolean;
  composer: boolean;
  embedModel: string;
  weights: PersonalWeights;
}

export const PERSONAL_SETTING_KEY = 'personal-config';

const EMBED_MODEL_RE = /^(cloudflare|gemini):[A-Za-z0-9@/._-]{2,80}$/;

export function sanitizePersonalConfig(raw: unknown): PersonalConfig {
  const v = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const weights = { ...PERSONAL_WEIGHT_DEFAULTS };
  const w = v.weights && typeof v.weights === 'object' && !Array.isArray(v.weights) ? (v.weights as Record<string, unknown>) : {};
  for (const key of Object.keys(weights) as Array<keyof PersonalWeights>) {
    const n = w[key];
    if (typeof n !== 'number' || !Number.isFinite(n)) continue;
    const d = PERSONAL_WEIGHT_DEFAULTS[key];
    weights[key] = Math.min(d * 2, Math.max(d * 0.5, n));
  }
  return {
    enabled: v.enabled !== false,
    composer: v.composer !== false,
    embedModel: typeof v.embedModel === 'string' && EMBED_MODEL_RE.test(v.embedModel) ? v.embedModel : DEFAULT_EMBED_MODEL,
    weights,
  };
}

export async function personalConfig(env: DbEnv): Promise<PersonalConfig> {
  return sanitizePersonalConfig(await setting(env, PERSONAL_SETTING_KEY));
}

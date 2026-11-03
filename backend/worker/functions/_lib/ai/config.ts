/**
 * VinaX AI — the owner's switches, from the `vinax-ai` setting (written in
 * the console's Settings page):
 *
 *   { enabled: false,             // the kill switch; missing = off
 *     testers: ["<account id>"],  // may use VinaX AI while it is off
 *     search: true,               // web search (phase 3)
 *     instructions: "…",          // the owner's instructions for every model (≤ 4,000 chars)
 *     limits: { messagesPerMinute, imagesPerMessage, filesPerMessage, filesPerChat,
 *               pdfMB, pdfPages, textMB, searchesPerDay },   // see LIMIT_RANGES
 *     models: { "<model id>": { enabled, order } },
 *     discover: true,             // free models found in the providers' lists join the picker;
 *                                 // false = none, { "<provider>": false } = not that provider's
 *     dailyLimit: 25 }            // messages per person per day (UTC); missing = no limit
 *
 * Values are sanitised here, so a bad value can never break the chat.
 */
import { setting } from '../settings';
import type { DbEnv } from '../db';
import { applyOverrides, modelById, MODELS } from './models';
import { DISCOVERY_PROVIDERS, discoveredModels, type DiscoverOptions } from './discovery';
import type { AiEnv, ModelSpec, ProviderId } from './types';

export interface AiSettings {
  enabled: boolean;
  testers: string[];
  search: boolean;
  models: Record<string, unknown>;
  /** Messages one person may send a day; null = unlimited. */
  dailyLimit: number | null;
  /** The owner's instructions, added to every reply's system prompt ('' = none). */
  instructions: string;
  limits: AiLimits;
  /** Found free models in the picker: true (all), false (none), or the providers switched off. */
  discover: boolean | Partial<Record<ProviderId, false>>;
}

/** The owner's limits for VinaX AI; each is clamped to its range, and a missing or bad value is the default. */
export interface AiLimits {
  messagesPerMinute: number;
  imagesPerMessage: number;
  filesPerMessage: number;
  filesPerChat: number;
  pdfMB: number;
  pdfPages: number;
  textMB: number;
  /** null = the Worker's SEARCH_DAILY_LIMIT (else 100); 0 = the search API off. */
  searchesPerDay: number | null;
}

/** [min, max, default]. messagesPerMinute stops at 30: each account also has a fixed 30-a-minute cap (RATE_LIMIT_30). */
export const LIMIT_RANGES = Object.freeze({
  messagesPerMinute: [1, 30, 20],
  imagesPerMessage: [1, 20, 10],
  filesPerMessage: [1, 20, 20],
  filesPerChat: [1, 100, 50],
  pdfMB: [1, 50, 30],
  pdfPages: [1, 1_000, 500],
  textMB: [1, 5, 2],
} as const);
export const MAX_SEARCHES_PER_DAY = 2_000;
export const MAX_OWNER_INSTRUCTIONS = 4_000;
export const DEFAULT_LIMITS: AiLimits = Object.freeze({
  ...(Object.fromEntries(Object.entries(LIMIT_RANGES).map(([k, r]) => [k, r[2]])) as Omit<AiLimits, 'searchesPerDay'>),
  searchesPerDay: null,
});

export function sanitizeLimits(raw: unknown): AiLimits {
  const v = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const out = { ...DEFAULT_LIMITS };
  for (const [key, [min, max]] of Object.entries(LIMIT_RANGES) as Array<[keyof typeof LIMIT_RANGES, readonly [number, number, number]]>) {
    const n = Number(v[key]);
    if (v[key] != null && v[key] !== '' && Number.isFinite(n)) out[key] = Math.min(max, Math.max(min, Math.round(n)));
  }
  const s = v.searchesPerDay;
  if (s != null && s !== '' && Number.isFinite(Number(s))) out.searchesPerDay = Math.min(MAX_SEARCHES_PER_DAY, Math.max(0, Math.round(Number(s))));
  return out;
}

/** The owner's instructions, as plain text: control characters out, trimmed and capped. */
function cleanInstructions(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  return raw.replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, MAX_OWNER_INSTRUCTIONS);
}

export const AI_SETTING_KEY = 'vinax-ai';

export function sanitizeAiSettings(raw: unknown): AiSettings {
  const v = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const testers = Array.isArray(v.testers) ? v.testers.filter((t): t is string => typeof t === 'string' && t.length > 0 && t.length < 100).slice(0, 50) : [];
  const models = v.models && typeof v.models === 'object' && !Array.isArray(v.models) ? (v.models as Record<string, unknown>) : {};
  const lim = typeof v.dailyLimit === 'number' && Number.isFinite(v.dailyLimit) && v.dailyLimit >= 1 ? Math.min(10_000, Math.floor(v.dailyLimit)) : null;
  return { enabled: v.enabled === true, testers, search: v.search !== false, models, instructions: cleanInstructions(v.instructions), limits: sanitizeLimits(v.limits), dailyLimit: lim, discover: sanitizeDiscover(v.discover) };
}

const DISCOVER_KEYS: readonly ProviderId[] = ['groq', 'gemini', 'openrouter', 'nvidia', 'cloudflare'];

function sanitizeDiscover(raw: unknown): AiSettings['discover'] {
  if (raw === false) return false;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return true;
  const off = DISCOVER_KEYS.filter((p) => (raw as Record<string, unknown>)[p] === false);
  return off.length ? Object.fromEntries(off.map((p) => [p, false])) as Partial<Record<ProviderId, false>> : true;
}

export async function aiSettings(env: DbEnv): Promise<AiSettings> {
  return sanitizeAiSettings(await setting(env, AI_SETTING_KEY));
}

/** May this account use VinaX AI now? */
export const aiOpenFor = (s: AiSettings, accountId: string | null): boolean => s.enabled || (!!accountId && s.testers.includes(accountId));

/** The curated registry after the owner's model overrides (Auto's ladders, the music and backstage tasks). */
export const registryFor = (s: AiSettings): ModelSpec[] => applyOverrides(MODELS, s.models);

/**
 * The picker's registry: the curated models, then the free models found in
 * the providers' lists (discovery.ts), after the owner's switches. Any
 * discovery failure leaves the curated registry as it is.
 */
export async function pickerRegistryFor(env: AiEnv, s: AiSettings, o: DiscoverOptions = {}): Promise<ModelSpec[]> {
  const found = s.discover === false ? [] : await discoveredModels(env, s.discover, o);
  return applyOverrides([...MODELS, ...found], s.models);
}

/**
 * A model the listener picked that is not curated: it must be in the
 * provider's current list (found by discovery) and not switched off by the
 * owner. Only that provider's list is consulted. Arbitrary ids never get
 * through: null means `unknown_model`.
 */
export async function foundModelFor(env: AiEnv, s: AiSettings, id: unknown, o: Omit<DiscoverOptions, 'only'> = {}): Promise<ModelSpec | null> {
  if (typeof id !== 'string' || id.length > 200 || s.discover === false) return null;
  const p = id.slice(0, id.indexOf(':')) as ProviderId;
  if (!DISCOVERY_PROVIDERS.includes(p)) return null;
  const found = await discoveredModels(env, s.discover, { ...o, only: [p] });
  const spec = modelById(applyOverrides(found, s.models), id);
  return spec?.discovered ? spec : null;
}

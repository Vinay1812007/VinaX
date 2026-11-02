/**
 * VinaX music AI — what the three music routes share (POST /api/ai/rerank,
 * POST /api/ai/home-layout and the song generator): the owner's switches,
 * the gate every request passes, the `music` ladder with its failover, a
 * strict reader for the JSON a model answers with, and the sanitisers for
 * the compact summaries a device sends.
 *
 * What a device sends is always a SUMMARY built on the device (docs/data-and-
 * privacy.md lists it field by field): never the history, the heard-set or a
 * song title. Every model answer is checked against the input before it goes
 * back, so a model cannot invent a song or a key. The app works the same
 * without any of this: each route has an on-device fallback.
 */
import { CORS, json } from '../authShared';
import { bearer, readSession } from '../googleAuth';
import { bindingAllows, rateLimitAsync } from '../ratelimit';
import { setting } from '../settings';
import { anyProviderConfigured, providerConfigured } from './adapters';
import { aiSettings, registryFor } from './config';
import { ladderModels } from './models';
import { runChat } from './router';
import type { AiEnv, ModelSpec } from './types';

export const MUSIC_SETTING_KEY = 'ai-music';

export interface MusicAiSettings {
  /** The kill switch for every music AI route. Missing = on. */
  enabled: boolean;
  /** Up Next's AI rerank. Missing = on. */
  rerank: boolean;
  /** Home's AI layout. Missing = on. */
  home: boolean;
  /** Song generation: off until the owner turns it on (a feature flag), with its own daily quota per device. */
  generate: { enabled: boolean; dailyQuota: number };
}

export const DEFAULT_DAILY_QUOTA = 5;

export function sanitizeMusicSettings(raw: unknown): MusicAiSettings {
  const v = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const g = v.generate && typeof v.generate === 'object' && !Array.isArray(v.generate) ? (v.generate as Record<string, unknown>) : {};
  const quota = typeof g.dailyQuota === 'number' && Number.isFinite(g.dailyQuota) ? Math.round(g.dailyQuota) : DEFAULT_DAILY_QUOTA;
  return {
    enabled: v.enabled !== false,
    rerank: v.rerank !== false,
    home: v.home !== false,
    generate: { enabled: g.enabled === true, dailyQuota: Math.max(1, Math.min(50, quota)) },
  };
}

export async function musicSettings(env: AiEnv): Promise<MusicAiSettings> {
  return sanitizeMusicSettings(await setting(env, MUSIC_SETTING_KEY));
}

/** The music ladder's models that have a key, after the owner's model switches. */
export async function musicCandidates(env: AiEnv): Promise<ModelSpec[]> {
  const registry = registryFor(await aiSettings(env));
  return ladderModels(registry, 'music').filter((spec) => providerConfigured(env, spec.provider));
}

export type MusicFeature = 'rerank' | 'home';

const tooMany = (): Response =>
  new Response(JSON.stringify({ error: 'rate_limited', retryAfter: 60 }), { status: 429, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'retry-after': '60', ...CORS } });

/**
 * Every music AI request: the per-address bucket, a session, the per-account
 * tier, a configured provider and the owner's switches, in that order. Returns
 * the account and the models to try, or the response to send.
 */
export async function musicGate(request: Request, env: AiEnv, feature: MusicFeature, bucket: { capacity: number; refillPerMinute: number }): Promise<{ sub: string; candidates: ModelSpec[] } | Response> {
  const limited = await rateLimitAsync(request, `ai-${feature}`, bucket, env);
  if (limited) return limited;
  const sub = await readSession(env, bearer(request));
  if (!sub) return json({ error: 'signed_out' }, 401);
  if ((await bindingAllows(env, 'RATE_LIMIT_30', `ai-${feature}|account|${sub}`)) === false) return tooMany();
  if (!anyProviderConfigured(env)) return json({ error: 'ai_not_configured' }, 503);
  const s = await musicSettings(env);
  if (!s.enabled || !s[feature]) return json({ error: 'ai_disabled' }, 503);
  const candidates = await musicCandidates(env);
  if (!candidates.length) return json({ error: 'ai_not_configured' }, 503);
  return { sub, candidates };
}

/** The first JSON object in a model's answer: reasoning tags, code fences and chatter around it are ignored. */
export function extractJson(text: string): unknown {
  const t = text.replace(/<think>[\s\S]*?(<\/think>|$)/gi, '').replace(/```(?:json)?/gi, '');
  const start = t.indexOf('{');
  if (start < 0) return null;
  // Walk to the matching brace, respecting strings, so trailing chatter cannot break the parse.
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < t.length; i += 1) {
    const c = t[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === '{') depth += 1;
    else if (c === '}') {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(t.slice(start, i + 1)) as unknown;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

export interface JsonAnswer {
  value: unknown;
  model: ModelSpec;
}

/**
 * One short backstage task: the system text, the input as material, and the
 * whole answer within `deadlineMs`. Walks the ladder like the chat does
 * (a model that fails before answering is replaced by the next); returns
 * null on timeout, on failure, or when the answer holds no JSON object.
 */
export async function askJson(env: AiEnv, candidates: readonly ModelSpec[], task: { system: string; input: unknown; deadlineMs: number; maxOutputTokens: number; signal?: AbortSignal }): Promise<JsonAnswer | null> {
  if (!candidates.length) return null;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), Math.max(200, task.deadlineMs));
  const onOuter = (): void => ac.abort();
  task.signal?.addEventListener('abort', onOuter, { once: true });
  let text = '';
  let model: ModelSpec | null = null;
  try {
    for await (const ev of runChat(env, {
      candidates,
      picked: false,
      build: (spec) => ({
        model: spec,
        system: task.system,
        messages: [{ role: 'user', text: `<input>\n${JSON.stringify(task.input)}\n</input>` }],
        maxOutputTokens: task.maxOutputTokens,
        temperature: 0.2,
        reasoning: 'off',
        webSearch: false,
      }),
      signal: ac.signal,
      // Room for one failover inside the deadline.
      firstEventMs: Math.max(300, Math.floor(task.deadlineMs * 0.6)),
      budgetMs: task.deadlineMs,
    })) {
      if (ev.type === 'model') {
        model = ev.spec;
        text = '';
      } else if (ev.type === 'text') text += ev.delta;
      else if (ev.type === 'failed') return null;
    }
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    task.signal?.removeEventListener('abort', onOuter);
  }
  if (ac.signal.aborted || !model) return null;
  const value = extractJson(text);
  return value == null ? null : { value, model };
}

// ---------------------------------------------------------------- inputs --

// eslint-disable-next-line no-control-regex -- removing control characters is the point
const CONTROL = /[\u0000-\u001f\u007f<>`]/g;

/** A short plain string: control characters and markup removed, trimmed, clipped. Null when empty. */
export function cleanText(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null;
  const t = v.replace(CONTROL, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
  return t || null;
}

const list = (v: unknown, max: number, each: number, lower = false): string[] =>
  Array.isArray(v) ? [...new Set(v.map((x) => cleanText(x, each)).filter((x): x is string => !!x).map((x) => (lower ? x.toLowerCase() : x)))].slice(0, max) : [];

/** A number clamped to 0..1 and rounded to two places; null when it is not a number. */
export const unitOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? Math.round(Math.max(0, Math.min(1, v)) * 100) / 100 : null);
const unit = unitOrNull;

export type DiscoveryMode = 'familiar' | 'balanced' | 'discover';

/** The compact taste summary a device sends (frontend services/ai/tasteSummary.ts builds it). */
export interface TasteSummary {
  languages: string[];
  artists: string[];
  moods: string[];
  /** Mean energy 0..1 of what the listener plays at night, morning, afternoon, evening (null = no plays then). */
  energyByHour: Array<number | null>;
  discovery: DiscoveryMode;
  skipStreak: number;
  hour: number;
  weekday: number;
}

export function sanitizeTaste(raw: unknown): TasteSummary {
  const v = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const energy = Array.isArray(v.energyByHour) ? v.energyByHour.slice(0, 4).map(unit) : [];
  while (energy.length < 4) energy.push(null);
  const int = (x: unknown, lo: number, hi: number, d: number): number => (typeof x === 'number' && Number.isFinite(x) ? Math.max(lo, Math.min(hi, Math.round(x))) : d);
  return {
    languages: list(v.languages, 4, 24, true),
    artists: list(v.artists, 8, 60),
    moods: list(v.moods, 4, 20, true),
    energyByHour: energy,
    discovery: v.discovery === 'familiar' || v.discovery === 'discover' ? v.discovery : 'balanced',
    skipStreak: int(v.skipStreak, 0, 20, 0),
    hour: int(v.hour, 0, 23, 12),
    weekday: int(v.weekday, 0, 6, 0),
  };
}

/** This sitting's intent, as the device summarises it. */
export interface SittingIntent {
  mood: string | null;
  tune: string | null;
  language: string | null;
  /** −0.3..0.3: more energy (+) or less (−) than usual. */
  energySteer: number;
  completionStreak: number;
}

export function sanitizeIntent(raw: unknown): SittingIntent {
  const v = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const steer = typeof v.energySteer === 'number' && Number.isFinite(v.energySteer) ? Math.round(Math.max(-0.3, Math.min(0.3, v.energySteer)) * 100) / 100 : 0;
  const streak = typeof v.completionStreak === 'number' && Number.isFinite(v.completionStreak) ? Math.max(0, Math.min(20, Math.round(v.completionStreak))) : 0;
  return { mood: cleanText(v.mood, 20), tune: cleanText(v.tune, 24), language: cleanText(v.language, 24), energySteer: steer, completionStreak: streak };
}

/** A reason a listener reads ("Why this song?", a shelf's line): one plain sentence, no links, at most `max` characters. */
export function cleanReason(v: unknown, max = 90): string | null {
  const t = cleanText(v, 200);
  if (!t || /https?:|www\./i.test(t)) return null;
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

/**
 * What every /api/personal route shares: the gate (a session, a database,
 * the engine switched on), the CORS answer, the local-time words a request
 * may carry, and the account's first name for the composer.
 */
import { CORS, json, accountOf } from '../authShared';
import { firstNameOf } from '../ai/prompt';
import { bearer, readSession } from '../googleAuth';
import { dbConfigured } from '../db';
import { rateLimitAsync, bindingAllows } from '../ratelimit';
import { personalConfig, type PersonalConfig } from './config';
import type { PersonalEnv } from './engine';
import { isTasteMode } from './taste';
import type { TasteMode } from './types';

export const PERSONAL_CORS: Record<string, string> = { ...CORS, 'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS' };

export const options = (methods = 'GET, POST, DELETE, OPTIONS') => async (): Promise<Response> =>
  new Response(null, { status: 204, headers: { ...PERSONAL_CORS, 'access-control-allow-methods': methods } });

export interface Gate { sub: string; config: PersonalConfig }

/**
 * The session (401 signed_out), the database (503 unavailable), the engine
 * switch (503 personal_disabled), and the route's rate limits (429) — per IP
 * through the local bucket and, with `perAccount`, through the durable
 * binding tier per account.
 */
export async function gate(env: PersonalEnv, request: Request, route: string, limits: { capacity: number; refillPerMinute: number; perAccount?: 'RATE_LIMIT_10' | 'RATE_LIMIT_30' | 'RATE_LIMIT_60' | 'RATE_LIMIT_300' }): Promise<Gate | { fail: Response }> {
  const limited = await rateLimitAsync(request, route, { capacity: limits.capacity, refillPerMinute: limits.refillPerMinute }, env);
  if (limited) return { fail: limited };
  const sub = await readSession(env, bearer(request));
  if (!sub) return { fail: json({ error: 'signed_out' }, 401) };
  if (!dbConfigured(env)) return { fail: json({ error: 'unavailable' }, 503) };
  if (limits.perAccount && (await bindingAllows(env, limits.perAccount, `${route}|account|${sub}`)) === false) {
    return { fail: new Response(JSON.stringify({ error: 'rate_limited', retryAfter: 60 }), { status: 429, headers: { 'content-type': 'application/json', 'retry-after': '60', ...PERSONAL_CORS } }) };
  }
  const config = await personalConfig(env);
  if (!config.enabled) return { fail: json({ error: 'personal_disabled' }, 503) };
  return { sub, config };
}

/** The local-time words a request carries (`?hour=&dow=` or body fields). */
export function localTime(raw: { hour?: unknown; dow?: unknown }): { hour: number | null; dow: number | null } {
  const n = (v: unknown, max: number): number | null => {
    const x = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN;
    return Number.isFinite(x) && x >= 0 && x < max ? Math.floor(x) : null;
  };
  return { hour: n(raw.hour, 24), dow: n(raw.dow, 7) };
}

export const modeOf = (raw: unknown): TasteMode | null => (isTasteMode(raw) ? raw : null);

export async function firstName(env: PersonalEnv, sub: string): Promise<string | null> {
  const r = await accountOf(env, sub);
  return r.ok && r.value ? firstNameOf(r.value.name) : null;
}

export const personalJson = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'private, no-store', ...PERSONAL_CORS } });

/**
 * The personal engine's client (backend/worker/functions/api/personal/*).
 * Every call carries the Google session; every answer is checked before it
 * is used; a call has a deadline (12 s, 25 s for a playlist) so a slow
 * server never holds Home. Whether the engine is on for this device is
 * decided here too: signed in, the setting on, and not Kid mode (the kid
 * profile stays on the device).
 */
import { currentAccount } from '@/services/auth/google';
import { isNativePlatform } from '@/services/native';
import { useSettingsStore } from '@/store/settingsStore';
import { personalHomeOf, personalPlaylistOf, personalSongOf, type PersonalHomePage, type PersonalPlaylist, type PersonalSong, type PersonalTaste } from './types';

const ORIGIN = isNativePlatform() ? 'https://www.vinaxmusic.online' : '';
export const PERSONAL_BASE = `${ORIGIN}/api/personal`;

export class PersonalError extends Error {
  constructor(public status: number, public code: string) {
    super(code);
    this.name = 'PersonalError';
  }
}

/** Is the engine on for this device right now? */
export function personalEnabled(): boolean {
  const s = useSettingsStore.getState();
  return !!currentAccount() && s.personalEngine && !s.kidMode;
}

/** The local-time words every request carries. */
export function localTimeParams(now = new Date()): { hour: number; dow: number } {
  return { hour: now.getHours(), dow: now.getDay() };
}

async function call<T>(path: string, init: RequestInit & { timeoutMs?: number; fetchImpl?: typeof fetch } = {}): Promise<{ status: number; body: T | null }> {
  const account = currentAccount();
  if (!account) throw new PersonalError(401, 'signed_out');
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), init.timeoutMs ?? 12_000);
  const outer = init.signal;
  const onOuter = () => controller.abort();
  outer?.addEventListener('abort', onOuter, { once: true });
  try {
    const res = await (init.fetchImpl ?? fetch)(`${PERSONAL_BASE}${path}`, {
      ...init,
      signal: controller.signal,
      headers: { accept: 'application/json', ...(init.body ? { 'content-type': 'application/json' } : {}), authorization: `Bearer ${account.session}`, ...(init.headers ?? {}) },
    });
    if (res.status === 204) return { status: 204, body: null };
    const body = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
    if (!res.ok) throw new PersonalError(res.status, typeof body?.error === 'string' ? body.error : `http_${res.status}`);
    return { status: res.status, body };
  } catch (e) {
    if (e instanceof PersonalError) throw e;
    throw new PersonalError(0, controller.signal.aborted && !outer?.aborted ? 'timeout' : 'network');
  } finally {
    window.clearTimeout(timer);
    outer?.removeEventListener('abort', onOuter);
  }
}

export interface HomeQuery { fresh?: boolean; mode?: string; festival?: string | null; signal?: AbortSignal; fetchImpl?: typeof fetch }

/** The composed Home, or null when the model knows too little for one yet. */
export async function fetchPersonalHome(q: HomeQuery = {}): Promise<PersonalHomePage | null> {
  const { hour, dow } = localTimeParams();
  const params = new URLSearchParams({ hour: String(hour), dow: String(dow) });
  if (q.fresh) params.set('fresh', '1');
  if (q.mode) params.set('mode', q.mode);
  if (q.festival) params.set('festival', q.festival);
  const r = await call<unknown>(`/home?${params}`, { signal: q.signal, fetchImpl: q.fetchImpl });
  if (r.status === 204) return null;
  const page = personalHomeOf(r.body);
  if (!page) throw new PersonalError(r.status, 'bad_answer');
  return page;
}

export interface EventBatch { events: unknown[]; songs: unknown[]; mode?: string }

export async function postPersonalEvents(batch: EventBatch, o: { keepalive?: boolean; fetchImpl?: typeof fetch } = {}): Promise<{ accepted: number; duplicates: number; version: number | null }> {
  const r = await call<{ accepted?: number; duplicates?: number; version?: number | null }>('/events', { method: 'POST', body: JSON.stringify(batch), keepalive: o.keepalive, fetchImpl: o.fetchImpl, timeoutMs: 15_000 });
  return { accepted: r.body?.accepted ?? 0, duplicates: r.body?.duplicates ?? 0, version: r.body?.version ?? null };
}

export async function buildPersonalPlaylist(prompt: string, o: { count?: number; signal?: AbortSignal; fetchImpl?: typeof fetch } = {}): Promise<PersonalPlaylist> {
  const r = await call<unknown>('/playlist', { method: 'POST', body: JSON.stringify({ prompt, count: o.count, hour: localTimeParams().hour }), signal: o.signal, fetchImpl: o.fetchImpl, timeoutMs: 30_000 });
  const page = personalPlaylistOf(r.body);
  if (!page) throw new PersonalError(r.status, 'bad_answer');
  return page;
}

export async function fetchPersonalPlaylist(id: string, o: { signal?: AbortSignal; fetchImpl?: typeof fetch } = {}): Promise<PersonalPlaylist | null> {
  const r = await call<unknown>(`/playlist?id=${encodeURIComponent(id)}`, { signal: o.signal, fetchImpl: o.fetchImpl });
  return personalPlaylistOf(r.body);
}

export async function fetchPersonalRecommendations(o: { seed?: string | null; limit?: number; exclude?: string[]; mode?: string; signal?: AbortSignal; fetchImpl?: typeof fetch } = {}): Promise<PersonalSong[]> {
  const params = new URLSearchParams({ limit: String(o.limit ?? 20), hour: String(localTimeParams().hour) });
  if (o.seed) params.set('seed', o.seed);
  if (o.exclude?.length) params.set('exclude', o.exclude.slice(0, 200).join(','));
  if (o.mode) params.set('mode', o.mode);
  const r = await call<{ songs?: unknown[] }>(`/recommend?${params}`, { signal: o.signal, fetchImpl: o.fetchImpl });
  return (Array.isArray(r.body?.songs) ? r.body!.songs! : []).map(personalSongOf).filter((s): s is PersonalSong => !!s);
}

export async function fetchPersonalTaste(o: { fetchImpl?: typeof fetch } = {}): Promise<PersonalTaste | null> {
  const r = await call<PersonalTaste>('/taste', { fetchImpl: o.fetchImpl });
  return r.status === 204 ? null : r.body;
}

export async function erasePersonalTaste(o: { fetchImpl?: typeof fetch } = {}): Promise<Record<string, number>> {
  const r = await call<{ erased?: Record<string, number> }>('/taste', { method: 'DELETE', fetchImpl: o.fetchImpl });
  return r.body?.erased ?? {};
}

/** A line for the listener when a call fails. */
export function personalNotice(code: string): string {
  switch (code) {
    case 'signed_out': return 'Sign in to use the personal engine.';
    case 'personal_disabled': return 'The personal engine is switched off for now.';
    case 'rate_limited': return 'A moment — too many requests. Try again shortly.';
    case 'nothing_found': return 'Nothing in the catalogue fits that yet. Try other words.';
    case 'timeout': return 'The server took too long. Try again.';
    case 'network': return 'No connection to the server right now.';
    default: return 'Something went wrong. Try again.';
  }
}

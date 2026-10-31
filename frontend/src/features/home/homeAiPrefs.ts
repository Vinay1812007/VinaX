import { useSyncExternalStore } from 'react';
import type { AiBlockType } from '@/services/home/homeBuilder';

/**
 * 1.4 — the listener's choices about the AI Home Builder (Settings → Home):
 * whether the AI builds Home at all (on by default), and the shelves they said
 * they are not interested in. Those are sent as `avoid` with the next build and
 * left out of every Home built after it, by the AI and by the fallback order
 * alike. Nothing here changes the Home on screen: it takes effect on the next
 * generation (a refresh, "Rebuild Home now", or a visit after 30 minutes).
 *
 * Kept with the Home layout: it is part of the "Home layout" backup category
 * and of the account sync.
 */
export const HOME_AI_KEY = 'vinax.home.ai.v1';

export interface HomeAiPrefs {
  enabled: boolean;
  notInterested: AiBlockType[];
}

const DEFAULTS: HomeAiPrefs = { enabled: true, notInterested: [] };
const MAX_NOT_INTERESTED = 12;
const TYPE = /^[a-z]{3,12}$/;

export function sanitizeHomeAiPrefs(raw: unknown): HomeAiPrefs {
  const v = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const list = Array.isArray(v.notInterested) ? [...new Set(v.notInterested.filter((t): t is AiBlockType => typeof t === 'string' && TYPE.test(t)))].slice(0, MAX_NOT_INTERESTED) : [];
  return { enabled: v.enabled !== false, notInterested: list };
}

let cached: HomeAiPrefs | null = null;
const listeners = new Set<() => void>();

export function loadHomeAiPrefs(): HomeAiPrefs {
  if (cached) return cached;
  try {
    const raw = window.localStorage.getItem(HOME_AI_KEY);
    cached = raw ? sanitizeHomeAiPrefs(JSON.parse(raw)) : DEFAULTS;
  } catch {
    cached = DEFAULTS;
  }
  return cached;
}

function save(next: HomeAiPrefs): void {
  cached = next;
  try {
    window.localStorage.setItem(HOME_AI_KEY, JSON.stringify(next));
  } catch {
    /* kept in memory for this visit */
  }
  for (const l of listeners) l();
}

export function setHomeAiEnabled(enabled: boolean): void {
  save({ ...loadHomeAiPrefs(), enabled });
}

/** "Not interested in this shelf": it stays away from the next Home build on. */
export function markShelfNotInterested(type: AiBlockType): void {
  const p = loadHomeAiPrefs();
  if (p.notInterested.includes(type)) return;
  save({ ...p, notInterested: [...p.notInterested, type].slice(-MAX_NOT_INTERESTED) });
}

export function bringShelfBack(type: AiBlockType): void {
  const p = loadHomeAiPrefs();
  save({ ...p, notInterested: p.notInterested.filter((t) => t !== type) });
}

const subscribe = (l: () => void): (() => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function useHomeAiPrefs(): HomeAiPrefs {
  return useSyncExternalStore(subscribe, loadHomeAiPrefs, loadHomeAiPrefs);
}

/** Tests: forget the in-memory copy. */
export function resetHomeAiPrefsCache(): void {
  cached = null;
}

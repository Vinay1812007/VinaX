/**
 * The personal engine's reporter: turns what the taste profile learns
 * (services/personalization/tasteEvents.ts) into the event batches
 * POST /api/personal/events takes. Off unless signed in with the engine on
 * (services/personal/api `personalEnabled`); switching the engine off stops
 * it at once and clears the queue.
 *
 * The queue lives in local storage (KEYS.personalQueue) so a batch that did
 * not get out survives a reload; it flushes every FLUSH_MS, at FLUSH_AT
 * events, when the page hides (with keepalive) and when the connection
 * comes back. Each event carries a device-minted id, so a retried batch
 * counts once. Events older than a week that never got through are dropped.
 */
import { KEYS } from '@/constants/storage-keys';
import { onAccountChange } from '@/services/auth/google';
import { onTasteEvent, type TasteEvent } from '@/services/personalization/tasteEvents';
import { getLocal, setLocal } from '@/services/storage/local';
import { useSettingsStore } from '@/store/settingsStore';
import { PersonalError, personalEnabled, postPersonalEvents } from './api';
import { factsOf } from './types';

export const FLUSH_MS = 15_000;
export const FLUSH_AT = 25;
export const MAX_QUEUE = 400;
/** Events per batch; halved after a 413 (the server and `keepalive` both cap a body at 64 KB). */
const BATCH_MAX = 100;
let batchSize = BATCH_MAX;
const WEEK_MS = 7 * 86_400_000;
const SOURCE_WINDOW_MS = 8_000;

interface QueuedEvent {
  id: string;
  kind: TasteEvent['kind'];
  at: number;
  songId: string;
  heardSec?: number;
  durationSec?: number;
  source?: string;
  context: { hour: number; dow: number; tz?: string; shelf?: string; position?: number };
}

interface QueueFile { events: QueuedEvent[]; songs: Record<string, ReturnType<typeof factsOf>> }

const empty = (): QueueFile => ({ events: [], songs: {} });

let queue: QueueFile | null = null;
let timer: number | null = null;
let flushing: Promise<void> | null = null;
let installed = false;
let recentSource: { songId: string; source: string; shelf?: string; position?: number; at: number } | null = null;

const load = (): QueueFile => {
  if (queue) return queue;
  const raw = getLocal<Partial<QueueFile> | null>(KEYS.personalQueue, null);
  queue = raw && Array.isArray(raw.events) ? { events: raw.events, songs: raw.songs && typeof raw.songs === 'object' ? raw.songs : {} } : empty();
  return queue;
};
const save = (): void => { if (queue) setLocal(KEYS.personalQueue, queue); };

const newId = (): string => {
  const buf = new Uint8Array(8);
  crypto.getRandomValues(buf);
  return `${Date.now().toString(36)}-${Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('')}`;
};

const tz = (): string | undefined => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
};

/**
 * The personal Home tells the reporter where a play is about to come from,
 * so the next event for that song (within a few seconds) names the shelf.
 */
export function markPersonalSource(songId: string, source: string, shelf?: string, position?: number): void {
  recentSource = { songId, source, shelf, position, at: Date.now() };
}

/** Put one event on the queue (exported for tests; the subscription calls it). */
export function enqueue(e: TasteEvent): void {
  if (!personalEnabled()) return;
  const q = load();
  const now = new Date(e.at);
  const ev: QueuedEvent = {
    id: newId(), kind: e.kind, at: e.at, songId: e.song.id,
    context: { hour: now.getHours(), dow: now.getDay(), ...(tz() ? { tz: tz() } : {}) },
  };
  if (typeof e.heardSec === 'number') ev.heardSec = Math.round(e.heardSec);
  if (typeof e.song.duration === 'number') ev.durationSec = Math.round(e.song.duration);
  if (recentSource && recentSource.songId === e.song.id && e.at - recentSource.at < SOURCE_WINDOW_MS) {
    ev.source = recentSource.source;
    if (recentSource.shelf) ev.context.shelf = recentSource.shelf;
    if (typeof recentSource.position === 'number') ev.context.position = recentSource.position;
  }
  q.events.push(ev);
  q.songs[e.song.id] = factsOf(e.song);
  if (q.events.length > MAX_QUEUE) q.events.splice(0, q.events.length - MAX_QUEUE);
  prune(q);
  save();
  if (q.events.length >= FLUSH_AT) void flush();
  else arm();
}

function prune(q: QueueFile): void {
  const cutoff = Date.now() - WEEK_MS;
  q.events = q.events.filter((e) => e.at >= cutoff);
  const wanted = new Set(q.events.map((e) => e.songId));
  for (const id of Object.keys(q.songs)) if (!wanted.has(id)) delete q.songs[id];
}

function arm(): void {
  if (timer !== null || typeof window === 'undefined') return;
  timer = window.setTimeout(() => { timer = null; void flush(); }, FLUSH_MS);
}

/** Send what is queued. One flight at a time; a failure keeps the queue. */
export function flush(o: { keepalive?: boolean; fetchImpl?: typeof fetch } = {}): Promise<void> {
  if (flushing) return flushing;
  flushing = (async () => {
    const q = load();
    prune(q);
    if (!q.events.length || !personalEnabled()) { save(); return; }
    const events = q.events.slice(0, batchSize);
    const songIds = new Set(events.map((e) => e.songId));
    const songs = Object.values(q.songs).filter((s) => songIds.has(s.id));
    const drop = (ids: Set<string>) => { q.events = q.events.filter((e) => !ids.has(e.id)); prune(q); save(); };
    try {
      await postPersonalEvents({ events, songs, mode: useSettingsStore.getState().discoveryMode }, o);
      batchSize = Math.min(BATCH_MAX, batchSize * 2);
      drop(new Set(events.map((e) => e.id)));
      if (q.events.length) arm();
    } catch (e) {
      const status = e instanceof PersonalError ? e.status : 0;
      if (status === 401) { clearQueue(); return; }              // the session is gone: nothing can be sent
      if (status === 413) { batchSize = Math.max(5, Math.floor(batchSize / 2)); arm(); return; }  // too big: smaller next time
      if (status >= 400 && status < 500 && status !== 429) { drop(new Set(events.map((e) => e.id))); if (q.events.length) arm(); return; }  // refused for good: not again
      arm();                                                      // 429, 5xx, network: kept for the next flush
    }
  })().finally(() => { flushing = null; });
  return flushing;
}

export function clearQueue(): void {
  queue = empty();
  save();
  if (timer !== null) { window.clearTimeout(timer); timer = null; }
}

/** How many events wait (for tests and the settings line). */
export const queuedCount = (): number => load().events.length;

/** Start following listening. Idempotent; safe to call before sign-in. */
export function installPersonalReporter(): () => void {
  if (installed || typeof window === 'undefined') return () => undefined;
  installed = true;
  const offTaste = onTasteEvent(enqueue);
  const onHide = () => { if (document.visibilityState === 'hidden') void flush({ keepalive: true }); };
  const onPageHide = () => void flush({ keepalive: true });
  const onOnline = () => void flush();
  document.addEventListener('visibilitychange', onHide);
  window.addEventListener('pagehide', onPageHide);
  window.addEventListener('online', onOnline);
  const offAccount = onAccountChange((a) => { if (!a) clearQueue(); });
  const offSettings = useSettingsStore.subscribe((s, prev) => {
    if (s.personalEngine !== prev.personalEngine && !s.personalEngine) clearQueue();
  });
  if (queuedCount()) arm();
  return () => {
    installed = false;
    offTaste();
    offAccount();
    offSettings();
    document.removeEventListener('visibilitychange', onHide);
    window.removeEventListener('pagehide', onPageHide);
    window.removeEventListener('online', onOnline);
  };
}

/** For tests. */
export function _resetReporterForTests(): void {
  queue = null;
  batchSize = BATCH_MAX;
  recentSource = null;
  if (timer !== null) { window.clearTimeout(timer); timer = null; }
  flushing = null;
  installed = false;
}


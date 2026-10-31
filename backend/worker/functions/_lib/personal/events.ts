/**
 * The event batch a device sends to POST /api/personal/events, checked
 * field by field: `{ events: [...], songs: [...] }`, at most MAX_EVENTS
 * events and one song record per distinct song. Anything that does not fit
 * is dropped, never an error, so one odd field cannot stall a device's queue.
 */
import { asObject, clip } from '../edge';
import { cleanSongFacts, SONG_ID_RE } from './songs';
import { EVENT_KINDS, type EventContext, type EventKind, type PersonalEvent, type SongFacts } from './types';

export const MAX_EVENTS = 100;
export const MAX_BATCH_BYTES = 64 * 1024;
const ID_RE = /^[A-Za-z0-9_.:-]{4,64}$/;
const SOURCE_RE = /^[a-z][a-z0-9:_-]{0,60}$/;
const WEEK_MS = 7 * 86_400_000;

const isKind = (v: unknown): v is EventKind => typeof v === 'string' && (EVENT_KINDS as readonly string[]).includes(v);

function cleanContext(raw: unknown): EventContext | undefined {
  const o = asObject(raw);
  if (!o) return undefined;
  const out: EventContext = {};
  if (typeof o.hour === 'number' && o.hour >= 0 && o.hour < 24) out.hour = Math.floor(o.hour);
  if (typeof o.dow === 'number' && o.dow >= 0 && o.dow < 7) out.dow = Math.floor(o.dow);
  const tz = clip(o.tz, 64);
  if (tz && /^[A-Za-z_+-]+(\/[A-Za-z_+-]+){0,2}$/.test(tz)) out.tz = tz;
  const shelf = clip(o.shelf, 80);
  if (shelf) out.shelf = shelf;
  if (typeof o.position === 'number' && o.position >= 0 && o.position < 1000) out.position = Math.floor(o.position);
  return Object.keys(out).length ? out : undefined;
}

export function cleanEvent(raw: unknown, now: number): PersonalEvent | null {
  const o = asObject(raw);
  if (!o) return null;
  const id = typeof o.id === 'string' && ID_RE.test(o.id) ? o.id : null;
  const songId = typeof o.songId === 'string' && SONG_ID_RE.test(o.songId) ? o.songId : null;
  if (!id || !songId || !isKind(o.kind)) return null;
  const atRaw = typeof o.at === 'number' ? o.at : typeof o.at === 'string' ? Date.parse(o.at) : NaN;
  // A clock a week off (or a replayed queue) is pulled to the window's edge rather than refused.
  const at = Number.isFinite(atRaw) ? Math.min(now + 60_000, Math.max(now - WEEK_MS, atRaw)) : now;
  const num = (v: unknown, max: number) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.min(max, Math.round(v)) : undefined);
  const source = typeof o.source === 'string' && SOURCE_RE.test(o.source) ? o.source : undefined;
  const ev: PersonalEvent = { id, kind: o.kind, at, songId };
  const heardSec = num(o.heardSec, 36_000);
  const durationSec = num(o.durationSec, 36_000);
  const context = cleanContext(o.context);
  if (heardSec !== undefined) ev.heardSec = heardSec;
  if (durationSec !== undefined) ev.durationSec = durationSec;
  if (source) ev.source = source;
  if (context) ev.context = context;
  return ev;
}

export interface CleanBatch { events: PersonalEvent[]; songs: SongFacts[]; dropped: number }

export function cleanBatch(raw: unknown, now = Date.now()): CleanBatch {
  const o = asObject(raw) ?? {};
  const list = Array.isArray(o.events) ? o.events.slice(0, MAX_EVENTS) : [];
  const seen = new Set<string>();
  const events: PersonalEvent[] = [];
  let dropped = Math.max(0, (Array.isArray(o.events) ? o.events.length : 0) - list.length);
  for (const item of list) {
    const ev = cleanEvent(item, now);
    if (!ev || seen.has(ev.id)) { dropped += 1; continue; }
    seen.add(ev.id);
    events.push(ev);
  }
  const wanted = new Set(events.map((e) => e.songId));
  const songs: SongFacts[] = [];
  const have = new Set<string>();
  for (const item of Array.isArray(o.songs) ? o.songs.slice(0, MAX_EVENTS) : []) {
    const s = cleanSongFacts(item);
    if (!s || !wanted.has(s.id) || have.has(s.id)) continue;
    have.add(s.id);
    songs.push(s);
  }
  return { events, songs, dropped };
}

/** The shape the recording function takes. */
export const toRpcEvent = (e: PersonalEvent) => ({
  id: e.id, kind: e.kind, songId: e.songId, at: new Date(e.at).toISOString(),
  heardSec: e.heardSec ?? null, durationSec: e.durationSec ?? null, source: e.source ?? null, context: e.context ?? {},
});

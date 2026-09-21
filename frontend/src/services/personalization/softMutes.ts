/**
 * 7.2 — "Less like this": temporary, per-artist soft mutes the listener can
 * see and take back.
 *
 * A soft mute lives on the taste profile (`profile.softMuted`, keyed by the
 * lead artist's id, or the lower-cased name when the catalogue gave no id)
 * and expires on its own. While it lasts, the admission gate and the
 * candidate filter keep that artist out of automatic picks and Home shelves.
 * It is deliberately different from "Never play" (the library's permanent
 * `hiddenArtists` list): a soft mute is a nudge with an end date.
 *
 * Writing a mute is still `softMuteArtist` in `updater.ts` (the strong
 * negative signal plus the entry); this module adds what the song menu and
 * Settings need around it: a readable list, an exact Undo, unmute, restore
 * and clear. Everything goes through `withProfile` / `loadProfile`, so it
 * shares the one serialized read-modify-write with the play events.
 *
 * Lazy by design: only the song menu and the Settings / Taste Profile
 * screens import it, never the first-load graph.
 */
import type { Song } from '@/types';
import { applyDecay, type Affinity, type ArtistAffinity, type TasteProfile } from './profile';
import { loadProfile, withProfile } from './storage';
import { softMuteArtist } from './updater';

/** The expiry choices the song menu offers, in days. */
export const SOFT_MUTE_DAYS = [7, 14, 30] as const;
export const DEFAULT_SOFT_MUTE_DAYS = 14;
const DAY_MS = 86_400_000;
const MAX_DAYS = 90;

export interface SoftMute {
  /** The profile key: the artist id, or the lower-cased name. */
  key: string;
  /** Display name, as the catalogue wrote it (any script). */
  name: string;
  /** Epoch ms when the mute ends. */
  until: number;
}

export interface MuteReceipt {
  mute: SoftMute;
  /** Puts the profile back exactly as it was before this mute (entry and signal). Idempotent. */
  undo(): void;
}

// ------------------------------------------------------------ change feed --
const listeners = new Set<() => void>();
let version = 0;

/** Re-render hook for lists that show mutes (Settings, Taste Profile). */
export function subscribeSoftMutes(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Bumps on every change made through this module — a `useSyncExternalStore` snapshot. */
export function softMutesVersion(): number {
  return version;
}

function changed(): void {
  version += 1;
  for (const fn of [...listeners]) fn();
}

// ------------------------------------------------------------------ reads --
/** The profile key a mute of this song's lead artist uses (same rule as `softMuteArtist`). */
export function softMuteKey(song: Pick<Song, 'artists'>): string | null {
  const lead = song.artists?.[0];
  if (!lead || (!lead.id && !lead.name)) return null;
  return lead.id || lead.name.toLowerCase();
}

function nameFor(p: TasteProfile, key: string): string {
  const direct = p.artists[key]?.name ?? p.artists[`name:${key}`]?.name;
  if (direct) return direct;
  for (const a of Object.values(p.artists)) if (a.name && a.name.toLowerCase() === key) return a.name;
  // An id-keyed entry whose artist record is gone: say so rather than print an id.
  return /\d/.test(key) && !/\s/.test(key) ? 'An artist you muted' : key;
}

/** Active soft mutes, soonest to end first. Expired entries are never listed. */
export function listSoftMutes(now = Date.now()): SoftMute[] {
  const p = loadProfile();
  return Object.entries(p.softMuted ?? {})
    .filter(([, e]) => e.until > now)
    .map(([key, e]) => ({ key, name: nameFor(p, key), until: e.until }))
    .sort((a, b) => a.until - b.until || a.name.localeCompare(b.name));
}

/** Is this song's lead artist under an active soft mute? */
export function isArtistSoftMuted(song: Pick<Song, 'artists'>, now = Date.now()): boolean {
  const key = softMuteKey(song);
  const entry = key ? loadProfile().softMuted?.[key] : undefined;
  return !!entry && entry.until > now;
}

/** Whole days left, rounded up (a mute ending later today still has 1 day). */
export function daysLeft(until: number, now = Date.now()): number {
  return Math.max(0, Math.ceil((until - now) / DAY_MS));
}

// ----------------------------------------------------------------- writes --
interface Snapshot {
  key: string;
  mute: { until: number } | undefined;
  language: string | null;
  languageAffinity: Affinity | undefined;
  artists: Array<[string, ArtistAffinity | undefined]>;
  songId: string;
  songAffinity: Affinity | undefined;
  skips: number;
}

const copy = <T extends object>(v: T | undefined): T | undefined => (v ? { ...v } : undefined);

/** Everything `softMuteArtist` is about to touch, so Undo can put it back exactly. */
function snapshot(p: TasteProfile, song: Song, key: string): Snapshot {
  const artistKeys = new Set<string>();
  for (const a of song.artists.slice(0, 3)) {
    if (a.id) artistKeys.add(a.id);
    if (a.name) artistKeys.add(`name:${a.name.toLowerCase()}`);
  }
  return {
    key,
    mute: copy(p.softMuted?.[key]),
    language: song.language,
    languageAffinity: song.language ? copy(p.languages[song.language]) : undefined,
    artists: [...artistKeys].map((k) => [k, copy(p.artists[k])]),
    songId: song.id,
    songAffinity: copy(p.songs?.[song.id]),
    skips: p.totals.skips,
  };
}

function restore(p: TasteProfile, s: Snapshot): void {
  if (!p.softMuted) p.softMuted = {};
  if (s.mute) p.softMuted[s.key] = s.mute;
  else delete p.softMuted[s.key];
  if (s.language) {
    if (s.languageAffinity) p.languages[s.language] = s.languageAffinity;
    else delete p.languages[s.language];
  }
  for (const [k, a] of s.artists) {
    if (a) p.artists[k] = a;
    else delete p.artists[k];
  }
  if (p.songs) {
    if (s.songAffinity) p.songs[s.songId] = s.songAffinity;
    else delete p.songs[s.songId];
  }
  p.totals.skips = s.skips;
}

const clampDays = (days: number): number => (Number.isFinite(days) ? Math.min(MAX_DAYS, Math.max(1, Math.round(days))) : DEFAULT_SOFT_MUTE_DAYS);

/**
 * "Less like this" for `days`: soft-mutes the song's lead artist and records
 * the strong negative signal (via `softMuteArtist`). Returns the mute and an
 * exact Undo, or null when the song has no artist to mute.
 */
export function muteArtist(song: Song, days: number = DEFAULT_SOFT_MUTE_DAYS): MuteReceipt | null {
  const key = softMuteKey(song);
  const lead = song.artists?.[0];
  if (!key || !lead) return null;
  const d = clampDays(days);
  const held: { snap?: Snapshot } = {};
  withProfile((p) => {
    // Decay first, the same way the write below does, so the snapshot and the
    // write see the same numbers (decay is idempotent inside six hours).
    applyDecay(p);
    held.snap = snapshot(p, song, key);
    return p;
  });
  softMuteArtist(song, d);
  const until = loadProfile().softMuted?.[key]?.until ?? Date.now() + d * DAY_MS;
  changed();
  let undone = false;
  return {
    mute: { key, name: lead.name, until },
    undo: () => {
      const snap = held.snap;
      if (undone || !snap) return;
      undone = true;
      withProfile((p) => {
        restore(p, snap);
        return p;
      });
      changed();
    },
  };
}

/** End one mute now. Returns what was removed (for an Undo), or null if it was not active. */
export function unmuteArtist(key: string, now = Date.now()): SoftMute | null {
  const removed = listSoftMutes(now).find((m) => m.key === key) ?? null;
  if (!removed) return null;
  withProfile((p) => {
    if (p.softMuted) delete p.softMuted[key];
    return p;
  });
  changed();
  return removed;
}

/** Put mutes back (the Undo of an unmute or a clear). Ones that have ended meanwhile stay ended. */
export function restoreSoftMutes(mutes: readonly SoftMute[], now = Date.now()): void {
  const live = mutes.filter((m) => m.until > now);
  if (!live.length) return;
  withProfile((p) => {
    if (!p.softMuted) p.softMuted = {};
    for (const m of live) p.softMuted[m.key] = { until: m.until };
    return p;
  });
  changed();
}

/** End every mute now. Returns what was cleared (for an Undo). */
export function clearSoftMutes(now = Date.now()): SoftMute[] {
  const all = listSoftMutes(now);
  if (!all.length) return [];
  withProfile((p) => {
    p.softMuted = {};
    return p;
  });
  changed();
  return all;
}

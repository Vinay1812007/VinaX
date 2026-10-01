import type { Song } from '@/types';
import { addEvent } from '@/services/storage/idb';
import {
  applyDecay,
  bumpArtist,
  bumpDay,
  bumpEnergyPref,
  bumpHourBucket,
  bumpLanguage,
  bumpSong,
  rememberRecent,
  type AffinityEventKind,
  type TasteProfile,
} from './profile';
import { withProfile as withProfileCoalesced } from './storage';
import { energyOfSong, recordSessionPlay } from './session';
import { EVENT_WEIGHTS, SKIP_RETRACTS_PLAY } from './eventWeights';
import { noteSessionEvent } from './sessionIntent';

function logEvent(type: string, song: Song, playedSec?: number): void {
  void addEvent({
    ts: Date.now(),
    type,
    songId: song.id,
    title: song.title,
    artistNames: song.artists.map((a) => a.name),
    language: song.language,
    playedSec,
    songDuration: song.duration,
  });
}

/**
 * Locally-scoped in-place mutation helper. Routes through the single
 * serialized read-modify-write in storage.ts so a play event never overwrites
 * a queued _pendingProfile from another mutation (audit finding H7).
 */
function withProfile(fn: (p: TasteProfile) => void): void {
  withProfileCoalesced((profile) => {
    applyDecay(profile);
    fn(profile);
    return profile;
  });
}

/** Multipliers for one event's artist and language bumps (1 = in full). */
interface Damp {
  artist: number;
  language: number;
}
const FULL: Damp = { artist: 1, language: 1 };

function bumpAll(p: TasteProfile, song: Song, delta: number, kind: AffinityEventKind, damp: Damp = FULL): void {
  bumpLanguage(p, song.language, delta * damp.language, kind);
  for (const artist of song.artists.slice(0, 3)) {
    bumpArtist(p, artist.id, artist.name, delta * damp.artist, kind);
  }
  bumpSong(p, song.id, delta, kind);
}

/**
 * 9.0.0 — one sitting's share of the LONG-TERM profile. Passive listening
 * (a play, a finished play) counts in full for the first SITTING_ARTIST_FULL
 * plays of one lead artist in a sitting, at half up to SITTING_ARTIST_HALF,
 * and at a quarter after that; a language has a larger allowance. A sitting
 * ends after SITTING_GAP_MS of silence, as the session intent's does. So a
 * party night of forty songs by one artist still teaches the profile — about
 * as much as nineteen ordinary plays (8 + 12 × ½ + 20 × ¼) — without turning
 * that artist into the listener's long-term favourite. Explicit signals (likes, searches, queue
 * and playlist adds) and every negative signal always count in full, and the
 * song's own affinity is never damped (a repeat-one run already counts once).
 */
export const SITTING_ARTIST_FULL = 8;
export const SITTING_ARTIST_HALF = 20;
export const SITTING_LANGUAGE_FULL = 12;
export const SITTING_LANGUAGE_HALF = 30;
const SITTING_GAP_MS = 45 * 60_000;
const sitting = { last: 0, artists: new Map<string, number>(), languages: new Map<string, number>() };

const step = (n: number, full: number, half: number): number => (n <= full ? 1 : n <= half ? 0.5 : 0.25);

/** Count one play toward this sitting and return the damping for it (and for its COMPLETE). */
function sittingDamp(song: Song, now = Date.now(), count = true): Damp {
  if (now - sitting.last > SITTING_GAP_MS) {
    sitting.artists.clear();
    sitting.languages.clear();
  }
  sitting.last = now;
  const artist = (song.artists?.[0]?.id || song.artists?.[0]?.name || '').trim().toLowerCase();
  const language = song.language && song.language !== 'unknown' ? song.language : '';
  const bump = (map: Map<string, number>, key: string): number => {
    if (!key) return 0;
    const n = (map.get(key) ?? 0) + (count ? 1 : 0);
    if (count) map.set(key, n);
    return n;
  };
  return {
    artist: artist ? step(bump(sitting.artists, artist), SITTING_ARTIST_FULL, SITTING_ARTIST_HALF) : 1,
    language: language ? step(bump(sitting.languages, language), SITTING_LANGUAGE_FULL, SITTING_LANGUAGE_HALF) : 1,
  };
}

/** Tests: start a fresh sitting. */
export function resetSittingDamping(): void {
  sitting.last = 0;
  sitting.artists.clear();
  sitting.languages.clear();
}

export function recordPlay(song: Song): void {
  const damp = sittingDamp(song);
  withProfile((p) => {
    bumpAll(p, song, EVENT_WEIGHTS.PLAY, 'play', damp);
    p.totals.plays += 1;
    p.hourHistogram[new Date().getHours()] += 1;
    bumpDay(p, new Date().getDay());
    // 7.2.0 — the same weekday, per language: what the weekday ranking term learns from.
    if (song.language) ((p.languageDays ??= {})[song.language] ??= [0, 0, 0, 0, 0, 0, 0])[new Date().getDay()] += 1;
    bumpHourBucket(p, song.language, new Date().getHours());
    rememberRecent(p, song.id);
  });
  // Package A1 — feed the rolling session window so the current-mood arc
  // influences the next batch of recommendations. Session-only, never persisted.
  recordSessionPlay(song);
  logEvent('play', song);
}

export function recordComplete(song: Song, playedSec: number): void {
  // The same damping as the play it finishes (not another step).
  const damp = sittingDamp(song, Date.now(), false);
  withProfile((p) => {
    bumpAll(p, song, EVENT_WEIGHTS.COMPLETE, 'complete', damp);
    p.totals.completes += 1;
    bumpEnergyPref(p, energyOfSong(song));
  });
  noteSessionEvent('complete', song);
  logEvent('complete', song, playedSec);
}

export function recordSkip(song: Song, playedSec: number): void {
  withProfile((p) => {
    bumpAll(p, song, EVENT_WEIGHTS.SKIP - (SKIP_RETRACTS_PLAY ? EVENT_WEIGHTS.PLAY : 0), 'skip');
    p.totals.skips += 1;
    p.skippedSongIds = [song.id, ...(p.skippedSongIds ?? []).filter((id) => id !== song.id)].slice(0, 120);
  });
  noteSessionEvent('skip', song);
  logEvent('skip', song, playedSec);
}

export function recordFavorite(song: Song, favored: boolean): void {
  withProfile((p) => {
    bumpAll(p, song, favored ? EVENT_WEIGHTS.FAVORITE : -EVENT_WEIGHTS.FAVORITE, 'signal');
    p.totals.favorites += favored ? 1 : -1;
    if (p.totals.favorites < 0) p.totals.favorites = 0;
    const ids = p.likedSongIds ?? [];
    p.likedSongIds = favored ? [song.id, ...ids.filter((id) => id !== song.id)].slice(0, 200) : ids.filter((id) => id !== song.id);
  });
  noteSessionEvent(favored ? 'like' : 'unlike', song);
  if (favored) logEvent('favorite', song);
}

export function recordQueueAdd(song: Song): void {
  withProfile((p) => {
    bumpAll(p, song, EVENT_WEIGHTS.QUEUE_ADD, 'signal');
    p.totals.queueAdds += 1;
  });
  noteSessionEvent('queue_add', song);
  logEvent('queue_add', song);
}

/**
 * 8.5.0 — "Not interested" on one song (the library hides it for good). The
 * song and its artists lose two skips' worth; the language is untouched. The
 * undo only forgets the song: scores are floored at zero, so handing the
 * points back would make a dislike-then-undo NET positive for an artist the
 * profile knew nothing about. Decay returns them within weeks anyway.
 */
export function recordDislike(song: Song, disliked: boolean): void {
  withProfile((p) => {
    const ids = (p.dislikedSongIds ?? []).filter((id) => id !== song.id);
    if (!disliked) {
      p.dislikedSongIds = ids;
      return;
    }
    for (const artist of song.artists.slice(0, 3)) bumpArtist(p, artist.id, artist.name, EVENT_WEIGHTS.DISLIKE, 'signal');
    bumpSong(p, song.id, EVENT_WEIGHTS.DISLIKE, 'signal');
    p.totals.dislikes = (p.totals.dislikes ?? 0) + 1;
    p.dislikedSongIds = [song.id, ...ids].slice(0, 200);
    p.likedSongIds = (p.likedSongIds ?? []).filter((id) => id !== song.id);
  });
  if (!disliked) return;
  noteSessionEvent('dislike', song);
  logEvent('dislike', song);
}

/** 8.5.0 — the listener put a song in one of their own playlists: worth a play for its artists, language and the song. */
export function recordPlaylistAdd(song: Song): void {
  withProfile((p) => {
    bumpAll(p, song, EVENT_WEIGHTS.PLAYLIST_ADD, 'signal');
    p.totals.playlistAdds = (p.totals.playlistAdds ?? 0) + 1;
  });
  noteSessionEvent('queue_add', song);
  logEvent('playlist_add', song);
}

/**
 * v7.0.0 — the listener searched for something and played a result. Counted
 * on top of the ordinary PLAY the player records: a search is the clearest
 * statement of intent the app ever gets, for the long-term profile (a
 * modest extra bump) and for this sitting (a strong pull).
 */
export function recordSearchPlay(song: Song): void {
  withProfile((p) => {
    bumpAll(p, song, EVENT_WEIGHTS.SEARCH_PLAY, 'signal');
  });
  noteSessionEvent('search_play', song);
  logEvent('search_play', song);
}

/** Package A3 — the listener explicitly asked for less of an artist.
 *  Records a strong negative signal (5× skip weight) AND soft-mutes the
 *  primary artist for 14 days so nothing by them shows up on Home shelves.
 *  Undoable via unmuteArtist below. */
export function softMuteArtist(song: Song, days = 14): void {
  const primary = song.artists[0];
  if (!primary) return;
  const key = primary.id || primary.name.toLowerCase();
  const until = Date.now() + days * 86_400_000;
  withProfile((p) => {
    // Strong negative signal beyond a normal skip.
    bumpAll(p, song, EVENT_WEIGHTS.SOFT_MUTE, 'skip');
    p.totals.skips += 1;
    if (!p.softMuted) p.softMuted = {};
    p.softMuted[key] = { until };
  });
  logEvent('soft_mute', song);
  // Home's shelves apply the listener's safety settings when they render, and
  // a soft mute lives on the profile rather than in a store. Loaded on demand:
  // this module is first-load code and the Home hook is not.
  void import('@/features/home/useShelfSafety').then((m) => m.notifyShelfSafetyChanged()).catch(() => undefined);
}

// Undo path deliberately not exported yet — the 14-day natural expiry in
// applyDecay handles the common case, and the audit didn't ask for a
// manual unmute UI. When the "Muted artists" list ships in Settings it'll
// wire straight to the softMuted field on the profile.

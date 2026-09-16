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
  type TasteProfile,
} from './profile';
import { withProfile as withProfileCoalesced } from './storage';
import { energyOfSong, recordSessionPlay } from './session';
import { EVENT_WEIGHTS } from './eventWeights';

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

function bumpAll(p: TasteProfile, song: Song, delta: number, kind: 'play' | 'complete' | 'skip'): void {
  bumpLanguage(p, song.language, delta, kind);
  for (const artist of song.artists.slice(0, 3)) {
    bumpArtist(p, artist.id, artist.name, delta, kind);
  }
  bumpSong(p, song.id, delta, kind);
}

export function recordPlay(song: Song): void {
  withProfile((p) => {
    bumpAll(p, song, EVENT_WEIGHTS.PLAY, 'play');
    p.totals.plays += 1;
    p.hourHistogram[new Date().getHours()] += 1;
    bumpDay(p, new Date().getDay());
    bumpHourBucket(p, song.language, new Date().getHours());
    rememberRecent(p, song.id);
  });
  // Package A1 — feed the rolling session window so the current-mood arc
  // influences the next batch of recommendations. Session-only, never persisted.
  recordSessionPlay(song);
  logEvent('play', song);
}

export function recordComplete(song: Song, playedSec: number): void {
  withProfile((p) => {
    bumpAll(p, song, EVENT_WEIGHTS.COMPLETE, 'complete');
    p.totals.completes += 1;
    bumpEnergyPref(p, energyOfSong(song));
  });
  logEvent('complete', song, playedSec);
}

export function recordSkip(song: Song, playedSec: number): void {
  withProfile((p) => {
    bumpAll(p, song, EVENT_WEIGHTS.SKIP, 'skip');
    p.totals.skips += 1;
    p.skippedSongIds = [song.id, ...(p.skippedSongIds ?? []).filter((id) => id !== song.id)].slice(0, 120);
  });
  logEvent('skip', song, playedSec);
}

export function recordFavorite(song: Song, favored: boolean): void {
  withProfile((p) => {
    bumpAll(p, song, favored ? EVENT_WEIGHTS.FAVORITE : -EVENT_WEIGHTS.FAVORITE, 'play');
    p.totals.favorites += favored ? 1 : -1;
    if (p.totals.favorites < 0) p.totals.favorites = 0;
    const ids = p.likedSongIds ?? [];
    p.likedSongIds = favored ? [song.id, ...ids.filter((id) => id !== song.id)].slice(0, 200) : ids.filter((id) => id !== song.id);
  });
  if (favored) logEvent('favorite', song);
}

export function recordQueueAdd(song: Song): void {
  withProfile((p) => {
    bumpAll(p, song, EVENT_WEIGHTS.QUEUE_ADD, 'play');
    p.totals.queueAdds += 1;
  });
  logEvent('queue_add', song);
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
}

// Undo path deliberately not exported yet — the 14-day natural expiry in
// applyDecay handles the common case, and the audit didn't ask for a
// manual unmute UI. When the "Muted artists" list ships in Settings it'll
// wire straight to the softMuted field on the profile.

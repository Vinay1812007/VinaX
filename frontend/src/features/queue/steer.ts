import type { Song } from '@/types';
import { usePlayerStore } from '@/store/playerStore';
import { noteSessionEvent } from '@/services/personalization/sessionIntent';
import { muteArtist, softMuteKey, type MuteReceipt } from '@/services/personalization/softMutes';
import { inferMood, moodFromText, type Mood } from '@/services/recommendation/mood';
import { TUNE_OPTIONS, type TuneIntent } from '@/services/recommendation/tune';
import { songTextStyle } from '@/services/recommendation/style';
import { upcomingMix } from './origin';

/**
 * 7.2 — "More like this" and "Less like this" from a song menu.
 *
 * Both reuse what the player already has: the session intent (this sitting's
 * pull toward or away from an artist), the soft mute on the taste profile,
 * and the player's own rebuild of the automatic tail (`tuneQueue` /
 * `regenerateAutoTail`). A rebuild never touches the listener's hand-queued
 * or kept songs.
 *
 * Since 7.2 the player's rebuild replaces the recommender's picks only — the
 * album or playlist the listener started stays, like their hand-queued songs —
 * so a retune can follow the signal whenever something is playing. With no DJ
 * picks upcoming there is nothing to rebuild, and the signal simply steers the
 * next ones.
 */

const MOOD_TUNE: Partial<Record<Mood, TuneIntent>> = {
  romantic: 'romantic',
  energetic: 'energetic',
  chill: 'chill',
  melancholy: 'heartbreak',
  devotional: 'devotional',
};

/** The "Tune this queue" intent that matches this song: its style (8.3.0 — a DJ
 *  remix, folk or devotional song keeps that style; 8.3.1 — only a style the song
 *  says in its words, never a genre guess), else its mood, if clear. */
export function tuneForSong(song: Song): TuneIntent | null {
  const style = songTextStyle(song);
  if (style) return style;
  const tagged = song.mood ? moodFromText(song.mood) : 'neutral';
  const mood = tagged !== 'neutral' ? tagged : inferMood(song);
  return MOOD_TUNE[mood] ?? null;
}

export function tuneLabel(intent: TuneIntent): string {
  return TUNE_OPTIONS.find((o) => o.id === intent)?.label ?? intent;
}

/** Is there anything for a rebuild to replace (the recommender's picks after the current song)? */
export function canRetuneQuietly(): boolean {
  const { queue, index } = usePlayerStore.getState();
  if (!queue[index]) return false;
  return upcomingMix().auto > 0;
}

export interface MoreLikeThisResult {
  /** The automatic tail is being rebuilt. */
  retuned: boolean;
  /** The mood tune that rebuild uses, when the song has a clear mood. */
  intent: TuneIntent | null;
}

/**
 * "More like this": a positive signal for this sitting only (the same pull a
 * like gives the song's artist and language; nothing is written to the
 * long-term profile), then an immediate rebuild of the DJ picks — toward the
 * song's mood when it has a clear one, otherwise with the active tune kept.
 */
export function moreLikeThis(song: Song): MoreLikeThisResult {
  noteSessionEvent('like', song);
  if (!canRetuneQuietly()) return { retuned: false, intent: null };
  const intent = tuneForSong(song);
  const player = usePlayerStore.getState();
  if (intent) player.tuneQueue(intent);
  else player.regenerateAutoTail();
  return { retuned: true, intent };
}

export interface LessLikeThisResult {
  receipt: MuteReceipt;
  /** DJ picks by that artist were waiting, so the automatic picks were rebuilt without them. */
  refreshed: boolean;
}

/**
 * "Less like this" for `days`: a soft mute of the lead artist (with an exact
 * Undo). If DJ picks by that artist are already waiting in the queue, the
 * automatic picks are rebuilt so the mute is felt now, not five songs later.
 */
export function lessLikeThis(song: Song, days: number): LessLikeThisResult | null {
  const receipt = muteArtist(song, days);
  if (!receipt) return null;
  const player = usePlayerStore.getState();
  const waiting = player.autoTail().some((s) => softMuteKey(s) === receipt.mute.key);
  const refreshed = waiting && canRetuneQuietly();
  if (refreshed) player.regenerateAutoTail();
  return { receipt, refreshed };
}

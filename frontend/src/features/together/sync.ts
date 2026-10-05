/**
 * Listen Together — the sync arithmetic, kept free of React, stores and the
 * network so every rule here is unit-tested (sync.test.ts).
 *
 * 10.0 rewrite. The old follower anchored the host's position on the moment
 * IT first saw a new `updated_at`, which is up to one poll interval after the
 * host wrote it. Guests therefore ran a second or two behind, crossed the
 * 1.2 s threshold, seeked, fell behind again and seeked again — the stutter
 * listeners reported as "Listen Together is not working".
 *
 * Now the server answers every poll with its own clock (`now`). The host's
 * push is stamped by that same clock (`updated_at`), so how far the host has
 * played since its last push is `now − updated_at`: two readings of ONE
 * clock, with no device clock skew involved. Half the measured round trip
 * covers the answer's flight back to us.
 */

export interface PollSnapshot {
  position: number;
  playing: boolean;
  updated_at: string;
  /** Server clock (ms) when it answered. Absent on a Worker older than 10.0. */
  now?: number;
  rttMs?: number;
  /** performance.now() when the answer landed. */
  receivedAt?: number;
}

/** Projects the host's playhead from the latest poll. */
export class HostClock {
  private base = 0;
  private baseAt = 0;
  private playing = false;
  // Legacy anchor (no server clock): keyed on updated_at changes.
  private legacyStamp = '';

  ingest(p: PollSnapshot, at: number = p.receivedAt ?? performance.now()): void {
    this.playing = p.playing;
    if (typeof p.now === 'number' && Number.isFinite(p.now)) {
      const pushed = Date.parse(p.updated_at);
      const sincePush = Number.isFinite(pushed) ? Math.max(0, p.now - pushed) : 0;
      const flight = Math.max(0, (p.rttMs ?? 0) / 2);
      this.base = p.position + (p.playing ? (sincePush + flight) / 1000 : 0);
      this.baseAt = at;
      return;
    }
    // Pre-10.0 Worker: the old behaviour, so a stale deploy still works.
    if (p.updated_at !== this.legacyStamp) {
      this.legacyStamp = p.updated_at;
      this.base = p.position + (p.playing ? 0.35 : 0);
      this.baseAt = at;
    }
  }

  /** Host position (seconds) at `at` (a performance.now() reading). */
  positionAt(at: number = performance.now()): number {
    const elapsed = this.playing ? Math.max(0, at - this.baseAt) / 1000 : 0;
    return Math.max(0, this.base + elapsed);
  }
}

export interface LocalPlayer {
  songId: string | null;
  isPlaying: boolean;
  isBuffering: boolean;
  currentTime: number;
  duration: number;
}

export type Correction =
  | { kind: 'none'; drift: number | null }
  | { kind: 'load'; drift: null }
  | { kind: 'play'; drift: number | null }
  | { kind: 'pause'; drift: number | null }
  | { kind: 'seek'; to: number; drift: number };

/** Drift beyond this (seconds) is audible as an echo between two phones. */
export const SEEK_THRESHOLD_S = 1.0;
/** A paused host only needs the guest roughly in place. */
const PAUSED_SEEK_THRESHOLD_S = 2.0;
/** Between corrections: a seek makes the guest buffer, and correcting again
 *  mid-buffer is what used to make followers flap. */
export const CORRECTION_COOLDOWN_MS = 3000;
/** A freshly loaded track reports a moving currentTime before it settles. */
export const TRACK_SETTLE_MS = 1500;

export function decideCorrection(input: {
  hostSongId: string | null;
  hostPlaying: boolean;
  expected: number;
  local: LocalPlayer;
  sinceLastCorrectionMs: number;
  sinceTrackStartMs: number;
}): Correction {
  const { hostSongId, hostPlaying, expected, local } = input;
  if (!hostSongId) return { kind: 'none', drift: null };
  if (local.songId !== hostSongId) return { kind: 'load', drift: null };
  const drift = local.currentTime - expected;
  if (local.isBuffering) return { kind: 'none', drift };
  if (input.sinceLastCorrectionMs < CORRECTION_COOLDOWN_MS) return { kind: 'none', drift };
  if (hostPlaying !== local.isPlaying) return { kind: hostPlaying ? 'play' : 'pause', drift };
  if (input.sinceTrackStartMs < TRACK_SETTLE_MS) return { kind: 'none', drift };
  const limit = hostPlaying ? SEEK_THRESHOLD_S : PAUSED_SEEK_THRESHOLD_S;
  if (Math.abs(drift) <= limit) return { kind: 'none', drift };
  // Never seek past the end: the guest would skip ahead of the host's next song.
  const ceiling = local.duration > 1 ? local.duration - 0.5 : expected;
  return { kind: 'seek', to: Math.max(0, Math.min(expected, ceiling)), drift };
}

/** How long without a host push before guests are told the host went quiet.
 *  Hosts push every few seconds while visible; a locked phone throttles that,
 *  but followers keep projecting the playhead meanwhile, so this is a note,
 *  not a disconnect. */
export const HOST_AWAY_MS = 90_000;

export function hostIsAway(p: { updated_at: string; now?: number }): boolean {
  if (typeof p.now !== 'number') return false;
  const pushed = Date.parse(p.updated_at);
  return Number.isFinite(pushed) && p.now - pushed > HOST_AWAY_MS;
}

/**
 * Room reactions, de-duplicated. Polls return the last few seconds of
 * reactions on every call; the old code compared their SERVER timestamps to
 * this device's clock, so a phone a few seconds fast never saw anyone's
 * reactions and a slow one replayed them. Now each reaction is identified by
 * its own stamp + emoji, the first poll only primes (nothing from before you
 * arrived floats), and your own tap — already floated locally — is skipped
 * once when the poll echoes it back.
 */
export class ReactionFeed {
  private seen = new Set<string>();
  private primed = false;
  private own: Array<{ e: string; until: number }> = [];

  /** Call when this device sends a reaction it has already shown. */
  sent(e: string, nowMs: number = Date.now()): void {
    this.own.push({ e, until: nowMs + 10_000 });
  }

  /** Returns the emojis to float for this poll. */
  ingest(list: Array<{ e: string; at: string }> | undefined, nowMs: number = Date.now()): string[] {
    this.own = this.own.filter((o) => o.until > nowMs);
    const fresh: string[] = [];
    for (const r of list ?? []) {
      const key = `${r.at}|${r.e}`;
      if (this.seen.has(key)) continue;
      this.seen.add(key);
      if (!this.primed) continue;
      const mine = this.own.findIndex((o) => o.e === r.e);
      if (mine >= 0) {
        this.own.splice(mine, 1);
        continue;
      }
      fresh.push(r.e);
    }
    this.primed = true;
    if (this.seen.size > 200) this.seen = new Set([...this.seen].slice(-100));
    return fresh;
  }
}

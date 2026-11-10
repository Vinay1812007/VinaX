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
 *
 * 1.12.10: close the last half second. Listeners heard the host "a little
 * fast" and the guest "a little slow". Four small delays all leaned the same
 * way, and nothing corrected a gap under a full second:
 *   - a host push was sent with the position it had when it LEFT the phone,
 *     but stamped when it arrived (`Flight` now measures that trip);
 *   - a guest counted the server's database time as network flight (`took`);
 *   - a seek landed late by however long the stream took to refill
 *     (`SeekLead` learns it and aims that far ahead);
 *   - and inside one second the guest was simply left where it was. It now
 *     plays a few percent faster or slower until it matches (`RateNudge`).
 */

export interface PollSnapshot {
  position: number;
  playing: boolean;
  updated_at: string;
  /** Server clock (ms) when it answered. Absent on a Worker older than 10.0. */
  now?: number;
  /** How long (ms) the server spent after reading `now` before it answered.
   *  Absent on a Worker older than 1.12.10. */
  took?: number;
  rttMs?: number;
  /** performance.now() when the answer landed. */
  receivedAt?: number;
  /** The host's song: a new song always re-anchors the playhead. */
  songId?: string | null;
}

/** A host push that disagrees with the last one by more than this is a real
 *  jump (a seek, a stall), not network jitter: it is taken as it is. */
export const CLOCK_SNAP_S = 0.25;
/** Otherwise a new push moves the estimate half of the way, so one push that
 *  crossed the network slowly cannot yank every guest's playhead about. */
const PUSH_BLEND = 0.5;
/** How many polls the server-clock estimate looks back over. */
const CLOCK_SAMPLES = 8;

/**
 * Projects the host's playhead between polls.
 *
 * Two things are estimated apart, because they go wrong in different ways:
 *
 *  - Which moment on the SERVER's clock is "now" on this device. Every poll
 *    measures it, off by however lopsided that poll's trip was. The clocks
 *    themselves do not drift in a few seconds, so the poll with the shortest
 *    trip among the last few is simply the best measurement, and a slow poll
 *    changes nothing.
 *  - Where the host's playhead was at a server moment: each host push says
 *    (`position` at `updated_at`). The first push after a song starts or
 *    resumes is sent while the host's own audio is still starting, so the
 *    next one replaces it; after that a push moves the line half way.
 */
export class HostClock {
  /** Server clock minus this device's performance.now(), ms, with each sample's flight. */
  private samples: Array<{ theta: number; flight: number }> = [];
  private theta = 0;
  /** The host's playhead (seconds) at server time `anchorAt` (ms). */
  private anchor = 0;
  private anchorAt = 0;
  /** Pushes read since the playhead last jumped. */
  private pushes = 0;
  private stamp = '';
  private playing = false;
  private song: string | null = null;
  // Pre-10.0 Worker (no server clock): anchored on this device's clock.
  private legacy = false;
  private base = 0;
  private baseAt = 0;

  /** True once a poll has been read: `positionAt` means something. */
  get ready(): boolean {
    return this.stamp !== '';
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  /** The host's song as of the last poll. */
  get songId(): string | null {
    return this.song;
  }

  ingest(p: PollSnapshot, at: number = p.receivedAt ?? performance.now()): void {
    const songId = p.songId ?? null;
    if (typeof p.now === 'number' && Number.isFinite(p.now)) {
      this.legacy = false;
      const rtt = Math.max(0, p.rttMs ?? 0);
      // The server's own share of the round trip is not flight time.
      const took = Math.min(rtt, Math.max(0, typeof p.took === 'number' && Number.isFinite(p.took) ? p.took : 0));
      const flight = (rtt - took) / 2;
      this.samples = [...this.samples, { theta: p.now + took + flight - at, flight }].slice(-CLOCK_SAMPLES);
      this.theta = this.samples.reduce((best, x) => (x.flight < best.flight ? x : best)).theta;

      const pushed = Date.parse(p.updated_at);
      const pushedAt = Number.isFinite(pushed) ? pushed : p.now;
      const fresh = p.updated_at !== this.stamp;
      const steady = this.pushes > 0 && p.playing && this.playing && songId === this.song;
      if (!steady) {
        this.anchor = p.position;
        this.anchorAt = pushedAt;
        this.pushes = 1;
      } else if (fresh) {
        // Where the line so far says the host was when this push was stamped.
        const believed = this.anchor + (pushedAt - this.anchorAt) / 1000;
        const off = p.position - believed;
        const trust = this.pushes === 1 || Math.abs(off) > CLOCK_SNAP_S ? 1 : PUSH_BLEND;
        this.anchor = believed + off * trust;
        this.anchorAt = pushedAt;
        this.pushes += 1;
      }
      this.stamp = p.updated_at;
      this.playing = p.playing;
      this.song = songId;
      return;
    }
    // Pre-10.0 Worker: the old behaviour, so a stale deploy still works.
    this.legacy = true;
    this.playing = p.playing;
    this.song = songId;
    if (p.updated_at !== this.stamp) {
      this.stamp = p.updated_at;
      this.base = p.position + (p.playing ? 0.35 : 0);
      this.baseAt = at;
    }
  }

  /** Host position (seconds) at `at` (a performance.now() reading). */
  positionAt(at: number = performance.now()): number {
    if (this.legacy) return Math.max(0, this.base + (this.playing ? Math.max(0, at - this.baseAt) / 1000 : 0));
    const elapsed = this.playing ? Math.max(0, at + this.theta - this.anchorAt) / 1000 : 0;
    return Math.max(0, this.anchor + elapsed);
  }
}

export interface LocalPlayer {
  songId: string | null;
  isPlaying: boolean;
  isBuffering: boolean;
  currentTime: number;
  duration: number;
}

/**
 * How long something takes to cross the network, from the last few trips:
 * the median, so one slow request (a cold connection) does not count.
 */
export class Flight {
  private samples: number[] = [];

  add(ms: number): void {
    if (!Number.isFinite(ms) || ms < 0) return;
    this.samples = [...this.samples, Math.min(ms, 1500)].slice(-5);
  }

  /** Milliseconds; 0 until something has been measured. */
  get ms(): number {
    if (!this.samples.length) return 0;
    const sorted = [...this.samples].sort((a, b) => a - b);
    return sorted[Math.floor((sorted.length - 1) / 2)];
  }
}

/** Start nudging the speed once the guest is this far off (seconds)… */
export const NUDGE_START_S = 0.06;
/** …and go back to normal speed once it is this close. */
export const NUDGE_STOP_S = 0.02;
/** The most the speed changes: 8 %, which closes 80 ms every second. Pitch is
 *  kept, so it is heard as nothing more than a slightly quicker beat. */
export const NUDGE_MAX = 0.08;
const NUDGE_MIN = 0.015;
/** Speed change per second of drift: full strength from 160 ms off. */
const NUDGE_GAIN = 0.5;
/** Further off than this, speeding up is pointless: it is a seek's job. */
const NUDGE_GIVE_UP_S = 3;

/**
 * Fine sync. Inside the seek threshold a guest is not moved (a seek is a
 * gap in the music); it plays a touch faster or slower until it is with the
 * host. `next` is the playback speed to use for a given drift
 * (guest position − host position, seconds).
 */
export class RateNudge {
  private active = false;

  next(drift: number): number {
    const off = Math.abs(drift);
    if (!Number.isFinite(off) || off > NUDGE_GIVE_UP_S || off < (this.active ? NUDGE_STOP_S : NUDGE_START_S)) {
      this.active = false;
      return 1;
    }
    this.active = true;
    const step = Math.min(NUDGE_MAX, Math.max(NUDGE_MIN, off * NUDGE_GAIN));
    // Ahead of the host: slow down. Behind: speed up.
    return drift > 0 ? 1 - step : 1 + step;
  }

  reset(): void {
    this.active = false;
  }
}

const SEEK_LEAD_MAX_S = 2;

/**
 * A seek is not instant: the stream refills for a moment while the host plays
 * on, so a guest that seeks to "where the host is now" lands behind. This
 * learns how far behind from each seek and aims the next one that far ahead.
 */
export class SeekLead {
  private lead: number;

  /** `start`: the first guess, before anything has been measured. */
  constructor(start = 0.25) {
    this.lead = start;
  }

  /** Seconds to aim ahead of the host. */
  get seconds(): number {
    return this.lead;
  }

  /** `drift` (guest − host, seconds) measured once a seek has settled. */
  learn(drift: number): void {
    // A gap of several seconds is something else (the host moved); learn nothing.
    if (!Number.isFinite(drift) || Math.abs(drift) > 3) return;
    this.lead = Math.min(SEEK_LEAD_MAX_S, Math.max(0, this.lead - drift * 0.6));
  }
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
/** This close to the end of the song, a guest that has stopped is waiting for
 *  the host's next song, not paused. */
export const END_GRACE_S = 2;

export function decideCorrection(input: {
  hostSongId: string | null;
  hostPlaying: boolean;
  expected: number;
  local: LocalPlayer;
  sinceLastCorrectionMs: number;
  sinceTrackStartMs: number;
  /** Seconds a seek should aim ahead of a PLAYING host (SeekLead). */
  seekLeadS?: number;
}): Correction {
  const { hostSongId, hostPlaying, expected, local } = input;
  if (!hostSongId) return { kind: 'none', drift: null };
  if (local.songId !== hostSongId) return { kind: 'load', drift: null };
  const drift = local.currentTime - expected;
  if (local.isBuffering) return { kind: 'none', drift };
  if (input.sinceLastCorrectionMs < CORRECTION_COOLDOWN_MS) return { kind: 'none', drift };
  // The song ran out here a moment before the host's: wait for the next one.
  // Pressing play now would start this song again from the top.
  if (hostPlaying && !local.isPlaying && local.duration > 1 && expected >= local.duration - END_GRACE_S) return { kind: 'none', drift };
  if (hostPlaying !== local.isPlaying) return { kind: hostPlaying ? 'play' : 'pause', drift };
  if (input.sinceTrackStartMs < TRACK_SETTLE_MS) return { kind: 'none', drift };
  const limit = hostPlaying ? SEEK_THRESHOLD_S : PAUSED_SEEK_THRESHOLD_S;
  if (Math.abs(drift) <= limit) return { kind: 'none', drift };
  // Never seek past the end: the guest would skip ahead of the host's next song.
  const ceiling = local.duration > 1 ? local.duration - 0.5 : expected;
  const target = expected + (hostPlaying ? Math.max(0, input.seekLeadS ?? 0) : 0);
  return { kind: 'seek', to: Math.max(0, Math.min(target, ceiling)), drift };
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

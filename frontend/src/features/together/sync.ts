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
 *
 * 1.12.11: measured against the live server with phone-like network delay,
 * a guest still settled 40 to 75 ms off (two phones in one room hear that as
 * an echo) and took 14 s to come back after the host paused. The host's
 * guess at each push's trip was the weak point: every push crossed the
 * network in a different time. Now the host keeps the server's clock too
 * (`ServerClock`) and sends each position with the server moment it was read
 * at, so no single message's trip matters. The guest closes to within 4 ms,
 * a play or pause lands in place, and a gap over 0.45 s is seeked.
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
/** After a start, a resume or a seek the host's audio takes a moment to run
 *  at full speed: this many pushes each replace the one before. */
const SETTLING_PUSHES = 2;
/** How many answers the server-clock estimate looks back over (80 s of a
 *  guest's polls, 160 s of a host's). */
const CLOCK_SAMPLES = 40;

/** What one answer from the room API says about the server's clock. */
export interface ClockReading {
  /** Server clock (ms) when the request arrived. */
  now?: number;
  /** How long (ms) the server then spent before it answered. */
  took?: number;
  /** The request's round trip (ms), and when the answer landed (performance.now()). */
  rttMs?: number;
  receivedAt?: number;
}

/**
 * Which moment on the SERVER's clock is "now" on this device.
 *
 * Every answer from the room API measures it, off by however lopsided that
 * request's trip was (and a busy phone only ever makes a trip look longer).
 * The two clocks do not drift apart in a minute or two, so the answer with
 * the shortest trip among the recent ones is simply the best measurement,
 * and a slow one changes nothing.
 *
 * The host and every guest each keep one. That is what makes the room exact:
 * the host says "my playhead was HERE at THIS server moment", a guest asks
 * "what is the server moment now?", and how long any one message took to
 * cross the network no longer matters. An error that both phones share (a
 * mobile network that is slower one way) cancels out.
 */
export class ServerClock {
  private samples: Array<{ theta: number; flight: number }> = [];
  private theta = 0;

  /** False until an answer carrying the server's clock has been read. */
  get ready(): boolean {
    return this.samples.length > 0;
  }

  /** Returns false for an answer with no server clock (a Worker older than 10.0). */
  add(r: ClockReading, at: number = r.receivedAt ?? performance.now()): boolean {
    if (typeof r.now !== 'number' || !Number.isFinite(r.now)) return false;
    const rtt = Math.max(0, r.rttMs ?? 0);
    // The server's own share of the round trip is not flight time.
    const took = Math.min(rtt, Math.max(0, typeof r.took === 'number' && Number.isFinite(r.took) ? r.took : 0));
    const flight = (rtt - took) / 2;
    this.samples = [...this.samples, { theta: r.now + took + flight - at, flight }].slice(-CLOCK_SAMPLES);
    this.theta = this.samples.reduce((best, x) => (x.flight < best.flight ? x : best)).theta;
    return true;
  }

  /** The server's clock (ms) at `at` (a performance.now() reading). */
  at(at: number = performance.now()): number {
    return at + this.theta;
  }
}

/**
 * Projects the host's playhead between polls: the server's clock
 * (`ServerClock`) and, on it, the line the host's pushes draw. Each push
 * says (`position` at `updated_at`). The first push after a song starts,
 * resumes or is seeked is sent while the host's own audio is still starting,
 * so the next two each replace it; after that a push moves the line half way.
 */
export class HostClock {
  private server = new ServerClock();
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
    if (this.server.add(p, at)) {
      this.legacy = false;
      const pushed = Date.parse(p.updated_at);
      const pushedAt = Number.isFinite(pushed) ? pushed : (p.now as number);
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
        const jumped = Math.abs(off) > CLOCK_SNAP_S;
        const trust = this.pushes <= SETTLING_PUSHES || jumped ? 1 : PUSH_BLEND;
        this.anchor = believed + off * trust;
        this.anchorAt = pushedAt;
        // The push that reports a seek is, like the first "playing", sent
        // while the host's audio is still refilling: the next ones replace it.
        this.pushes = jumped ? 1 : this.pushes + 1;
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
    const elapsed = this.playing ? Math.max(0, this.server.at(at) - this.anchorAt) / 1000 : 0;
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

/** Start nudging the speed once the guest is this far off (seconds). Two
 *  phones in one room are heard as one from about 30 ms apart… */
export const NUDGE_START_S = 0.012;
/** …and go back to normal speed once it is this close. */
export const NUDGE_STOP_S = 0.004;
/** The most the speed changes: 8 %, which closes 80 ms every second. Pitch is
 *  kept, so it is heard as nothing more than a slightly quicker beat. */
export const NUDGE_MAX = 0.08;
const NUDGE_MIN = 0.005;
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

/** Drift beyond this (seconds) is put right with a seek; inside it the guest
 *  changes speed instead (`RateNudge`). It was a full second while a seek
 *  landed anywhere within half a second; with `SeekLead` it lands close. */
export const SEEK_THRESHOLD_S = 0.45;
/** A paused host costs nothing to match exactly: a seek while paused is silent. */
const PAUSED_SEEK_THRESHOLD_S = 0.15;
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

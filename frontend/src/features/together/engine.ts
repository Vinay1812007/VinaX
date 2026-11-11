/**
 * Listen Together — the sync engine. One instance runs for the whole app
 * while a session is live (TogetherController mounts it from AppLayout), so
 * hosting and following keep working on every page, not only /together.
 *
 * Host: pushes the player's state when the song, play state or queue changes,
 * or the listener seeks; and every few seconds as a keep-alive. It polls the
 * room for members, reactions and guest requests, and adopts each request by
 * looking up the FULL song first. Guests send only an id, title and picture,
 * and the old host queued that stub as-is, so every guest request was
 * unplayable.
 *
 * Guest: polls every 2 s, projects the host's playhead with the server's clock
 * (sync.ts) and corrects with a cooldown. If the browser blocks audio (an
 * invite link opened without a tap), it raises `needsTap` instead of silently
 * sitting there muted.
 *
 * 1.12.10 — fine sync. A song now starts where the host is (not at 0:00 and
 * then a jump), a seek aims ahead by the time seeks have been taking, and
 * four times a second the guest compares its own playhead with the host's
 * and plays a few percent faster or slower until they match. Before, a guest
 * within a second of the host was left there, always on the late side.
 *
 * 1.12.11 — the host keeps the server's clock as well and sends each position
 * with the server moment it was read at; a guest that pauses or plays with
 * the host does it in place (a seek while paused is silent); and each device
 * has a fine-tune (`setTrimMs`) for a speaker that is slow to sound, which no
 * clock can measure.
 *
 * The room only NAMES a song (id, title, artwork): the server keeps no stream
 * URLs. So a guest looks the host's song up in the catalogue before playing
 * it, exactly as the host does for a guest's request. Guests used to hand the
 * room's stub straight to the player, which cannot play a song without
 * streams: joining failed and nobody but the host heard anything.
 */
import { getSong } from '@/services/api';
import { audioEngine } from '@/services/audio/engine';
import {
  createRoom,
  endRoom,
  getRoom,
  heartbeat,
  isHostOf,
  leaveRoom,
  leaveRoomBeacon,
  requestSong,
  sayInRoom,
  sendReaction,
  updateRoom,
  voteSkip,
  type RoomTrack,
} from '@/services/together';
import { useTogether } from '@/services/together/session';
import { usePlayerStore } from '@/store/playerStore';
import { toast } from '@/store/toastStore';
import type { Song } from '@/types';
import { KEYS } from '@/constants/storage-keys';
import { getLocal, setLocal } from '@/services/storage/local';
import { decideCorrection, HostClock, hostIsAway, RateNudge, ReactionFeed, SEEK_THRESHOLD_S, SeekLead, ServerClock, TRACK_SETTLE_MS } from './sync';

const HOST_POLL_MS = 4000;
const GUEST_POLL_MS = 2000;
/** After a play or a song change, how often the host looks for the audio to be really moving. */
const HOST_MOVING_CHECK_MS = 250;
/** …and after this many looks in a row with sound out, it is running at full speed. */
const HOST_SETTLED_LOOKS = 9;
/** How often a guest compares its playhead with the host's and trims its speed. */
const FINE_SYNC_MS = 250;
/** A freshly started song further off than this (seconds) is put right with one seek. */
const START_RESEEK_S = 0.25;
/** After a seek or a play/pause, how long before the playhead is judged again. */
const CORRECTION_SETTLE_MS = 600;

/**
 * The playhead right now, from the audio element. The store's `currentTime`
 * is as old as the last `timeupdate`; and for an instant after a song change
 * the engine still holds the previous song, so it is asked only about the
 * song the store says is playing.
 */
function playhead(): number {
  const s = usePlayerStore.getState();
  const song = s.queue[s.index];
  const live = song && audioEngine.currentSongId === song.id ? audioEngine.position() : null;
  return live ?? s.currentTime;
}
/** Guests heartbeat every third poll — the server counts a member as present
 *  for 12 s, and halving the POSTs keeps a houseful of phones on one Wi-Fi
 *  inside the per-address budget. */
const GUEST_HEARTBEAT_EVERY = 3;

let feed = new ReactionFeed();

/** 15.0 — the song the room last voted past (host side): never skipped twice. */
let lastVotedSkip: string | null = null;

/** 15.0 — the songs this session has played (for "save as a playlist"), in order, no repeats. */
function rememberPlayed(song: Song | null | undefined): void {
  // Only a song this device can play: the list is saved to the Library.
  if (!song || !isPlayable(song)) return;
  const st = useTogether.getState();
  if (st.played.some((s) => s.id === song.id)) return;
  st.patch({ played: [...st.played, song].slice(-200) });
}

/** 15.0 — say something to the room. */
export async function say(text: string): Promise<boolean> {
  const { code } = useTogether.getState();
  return code ? sayInRoom(code, text.trim().slice(0, 200)) : false;
}

/** 15.0 — vote to skip what is playing. The host simply skips. */
export async function voteToSkip(): Promise<void> {
  const st = useTogether.getState();
  if (!st.code) return;
  if (st.mode === 'host') { usePlayerStore.getState().next(true); return; }
  const song = st.hostSong;
  if (!song) return;
  const n = await voteSkip(st.code, song.id);
  if (n === null) toast('Could not send your vote');
  else { st.patch({ skipVotes: n }); toast(`Vote to skip: ${n}`); }
}

function floatReactions(list: Array<{ e: string; at: string }> | undefined): void {
  const fresh = feed.ingest(list);
  if (fresh.length) useTogether.getState().float(fresh);
}

/** Tap a reaction: it floats here at once, and the poll's echo is skipped. */
export function react(emoji: string): void {
  const { code } = useTogether.getState();
  if (!code) return;
  feed.sent(emoji);
  useTogether.getState().float([emoji]);
  void sendReaction(code, emoji).then((ok) => {
    if (!ok) toast('Reactions aren’t switched on for this server yet');
  });
}

// ------------------------------------------------------------------ host

const songCache = new Map<string, Song>();

/** A stub from the room has no stream URL; a real Song from the catalogue does. */
function isPlayable(song: Song): boolean {
  return Array.isArray(song.audio) && song.audio.length > 0;
}

async function fullSong(stub: Song): Promise<Song | null> {
  if (isPlayable(stub)) return stub;
  const hit = songCache.get(stub.id);
  if (hit) return hit;
  try {
    const song = await getSong(stub.id);
    songCache.set(stub.id, song);
    return song;
  } catch {
    return null;
  }
}

function runHost(code: string): () => void {
  let alive = true;
  // The server's clock, from the host's own polls: every push says at which
  // server moment its position was read.
  const server = new ServerClock();
  const requestedBy = new Map<string, string>();
  const consumed = new Set<string>();
  const adopting = new Set<string>();
  let inFlight = false;
  let again = false;

  const upNext = (): RoomTrack[] => {
    const s = usePlayerStore.getState();
    return s.queue.slice(s.index + 1, s.index + 9).map((sg) => ({ song: sg, by: requestedBy.get(sg.id) ?? null }));
  };

  // One push in flight at a time; a change during it schedules exactly one more.
  const push = async (): Promise<void> => {
    if (inFlight) {
      again = true;
      return;
    }
    inFlight = true;
    const s = usePlayerStore.getState();
    const up = upNext();
    useTogether.getState().patch({ queue: up });
    // The playhead and the moment it was read, taken together.
    const position = playhead();
    const read = performance.now();
    const r = await updateRoom(code, s.queue[s.index] ?? null, position, s.isPlaying, up, [...consumed], server.ready ? server.at(read) : undefined);
    inFlight = false;
    if (!alive) return;
    if (r === 'gone') {
      toast('This session has ended');
      useTogether.getState().reset();
      return;
    }
    if (r === 'forbidden') {
      toast('This device can no longer control that session — start a new one.');
      useTogether.getState().reset();
      return;
    }
    useTogether.getState().patch({ status: r === 'ok' ? 'live' : 'reconnecting' });
    if (again) {
      again = false;
      void push();
    }
  };

  // The push made the instant the host taps play, or a song changes, says
  // "playing" before any sound has come out: guests then count the host's
  // start-up time as music played and run ahead of it. So push once more as
  // soon as the audio is really moving; guests take that one as the truth.
  let watch = 0;
  const pushWhenMoving = (): void => {
    window.clearInterval(watch);
    let looks = 0;
    let moving = 0;
    watch = window.setInterval(() => {
      looks += 1;
      if (!alive || !usePlayerStore.getState().isPlaying || looks > 80) {
        window.clearInterval(watch);
        return;
      }
      moving = audioEngine.isAdvancing() ? moving + 1 : 0;
      // Once when sound is out, and once more two seconds in, when the audio
      // is past its start-up and running at full speed.
      if (moving === 2 || moving === HOST_SETTLED_LOOKS) void push();
      if (moving >= HOST_SETTLED_LOOKS) window.clearInterval(watch);
    }, HOST_MOVING_CHECK_MS);
  };

  let last = '';
  let lastT = usePlayerStore.getState().currentTime;
  let lastW = Date.now();
  let wasBuffering = usePlayerStore.getState().isBuffering;
  const unsub = usePlayerStore.subscribe((s) => {
    const song = s.queue[s.index] ?? null;
    const key = `${song?.id ?? ''}|${s.isPlaying}|${s.queue.length}|${s.index}`;
    // Seeks change neither song nor play state — catch them as a jump against
    // natural progression so guests re-sync now, not at the next keep-alive.
    const wall = Date.now();
    const expected = lastT + (s.isPlaying ? (wall - lastW) / 1000 : 0);
    const jumped = Math.abs(s.currentTime - expected) > 2;
    lastT = s.currentTime;
    lastW = wall;
    // The stream stalled and has just come back: the playhead stood still for
    // a moment the guests did not see. Tell them where it really is, once it
    // is moving again.
    const resumed = wasBuffering && !s.isBuffering;
    wasBuffering = s.isBuffering;
    if (key !== last || jumped) {
      last = key;
      void push();
      if (s.isPlaying) pushWhenMoving();
    } else if (resumed && s.isPlaying) {
      pushWhenMoving();
    }
  });

  const adopt = async (t: RoomTrack): Promise<void> => {
    const id = t.song?.id;
    if (!id || consumed.has(id) || adopting.has(id)) return;
    adopting.add(id);
    const who = t.by || 'A guest';
    const song = await fullSong(t.song);
    adopting.delete(id);
    consumed.add(id);
    if (!alive) return;
    if (!song) {
      toast(`Couldn’t add “${t.song.title}” from ${who} — it isn’t available`);
      return;
    }
    requestedBy.set(song.id, who);
    usePlayerStore.getState().enqueue(song);
    toast(`${who} added “${song.title}”`);
  };

  const poll = async (): Promise<void> => {
    void heartbeat(code);
    const d = await getRoom(code);
    if (!alive || !d) return;
    server.add(d);
    if (!d.room) {
      toast('This session has ended');
      useTogether.getState().reset();
      return;
    }
    useTogether.getState().patch({
      members: d.members ?? [],
      names: d.names ?? d.members ?? [],
      listenerCount: d.memberCount ?? d.members?.length ?? 1,
      messages: d.room.messages ?? [],
      skipVotes: d.room.skipVotes ?? 0,
    });
    floatReactions(d.reactions);
    // 15.0 — vote-to-skip: when more than half the room (host included) has
    // voted, the host's player moves on; the server clears the votes with
    // the new song.
    // memberCount already includes the host (it heartbeats too). Skip once
    // per song, and only the song this device is actually playing, so a
    // stale poll or a slow queue extension can never skip twice.
    const headcount = Math.max(1, d.memberCount ?? 1);
    const roomSong = d.room.song?.id ?? null;
    const st = usePlayerStore.getState();
    const playing = st.queue[st.index]?.id ?? null;
    // The host's own copy of the song, not the room's stub of it.
    if (st.isPlaying) rememberPlayed(st.queue[st.index]);
    if (roomSong && roomSong === playing && roomSong !== lastVotedSkip && (d.room.skipVotes ?? 0) > headcount / 2) {
      lastVotedSkip = roomSong;
      toast('The room voted to skip');
      st.next(true);
    }
    const requests = d.room.requests ?? [];
    await Promise.all(requests.map(adopt));
    if (alive) void push();
  };

  void push();
  void poll();
  const iv = window.setInterval(() => void poll(), HOST_POLL_MS);
  return () => {
    alive = false;
    unsub();
    window.clearInterval(iv);
    window.clearInterval(watch);
  };
}

// ----------------------------------------------------------------- guest

let lastCorrection = 0;
let trackStartedAt = 0;
let playAttempts = 0;

/** The host's playhead, and the room it is for. `joinSession` reads the room
 *  once before the engine starts, so the first song can already start in place. */
let clock = new HostClock();
let clockCode: string | null = null;
/** How far ahead a seek, and a freshly started song, must aim to land with the host. */
let seekLead = new SeekLead();
let startLead = new SeekLead(0.5);
/** A seek or a start whose landing has not been measured yet, and when it was made. */
let landing: { lead: SeekLead; at: number } | null = null;
/** A landing measured later than this says nothing about the seek (the host paused meanwhile, say). */
const LANDING_WINDOW_MS = 8000;

/** The most a device can be fine-tuned either way (ms). */
export const TRIM_MAX_MS = 500;
const cleanTrim = (ms: unknown): number => (typeof ms === 'number' && Number.isFinite(ms) ? Math.max(-TRIM_MAX_MS, Math.min(TRIM_MAX_MS, Math.round(ms))) : 0);
let trimMs = cleanTrim(getLocal<number>(KEYS.togetherTrim, 0));

/**
 * Fine-tune for THIS device as a guest: how many ms earlier (+) or later (−)
 * it plays than the host's signal. The sync matches what the two players are
 * decoding; how long a phone's speaker, or a Bluetooth one, then takes to
 * sound is different on every device and nothing here can measure it.
 */
export function getTrimMs(): number {
  return trimMs;
}
export function setTrimMs(ms: number): number {
  trimMs = cleanTrim(ms);
  setLocal(KEYS.togetherTrim, trimMs);
  return trimMs;
}

/** Where this guest should be at `at`: the host's playhead, plus this device's fine-tune while it plays. */
function target(at: number = performance.now()): number {
  return Math.max(0, clock.positionAt(at) + (clock.isPlaying ? trimMs / 1000 : 0));
}

/** Where a song that starts loading now should begin, to come in with the host. */
function startPosition(id: string): number {
  if (!clock.ready || clock.songId !== id) return 0;
  const at = target() + (clock.isPlaying ? startLead.seconds : 0);
  return at > 1 ? at : 0;
}

/** The host's song this device is looking up right now. */
let fetching: string | null = null;
/** The host's song this device could not get, and when it last tried. */
let missed: { id: string; at: number } | null = null;
/** How long before a song that could not be found is looked up again. */
const MISSED_RETRY_MS = 20_000;

/** Closer than this (seconds), a play or pause needs no seek to be in place. */
const IN_PLACE_S = 0.08;

/** A seek target kept inside the song. */
function inSong(seconds: number, duration: number): number {
  return Math.max(0, duration > 1 ? Math.min(seconds, duration - 0.5) : seconds);
}

/** Guest: start `song` where the host is, and note the start so its landing is measured. */
function startInPlace(song: Song): void {
  const at = startPosition(song.id);
  usePlayerStore.getState().playSong(song, { startAt: at });
  trackStartedAt = performance.now();
  landing = at > 0 && clock.isPlaying ? { lead: startLead, at: trackStartedAt } : null;
}

/**
 * Guest: get the host's song from the catalogue and start it. The room may
 * have moved on (or ended) while the lookup was in flight; then nothing plays.
 */
async function loadHostSong(stub: Song): Promise<void> {
  const id = stub.id;
  if (fetching === id) return;
  if (missed?.id === id && performance.now() - missed.at < MISSED_RETRY_MS) return;
  fetching = id;
  const song = await fullSong(stub);
  if (fetching === id) fetching = null;
  const room = useTogether.getState();
  if (room.mode !== 'guest' || room.hostSong?.id !== id) return;
  const st = usePlayerStore.getState();
  if (!song) {
    if (missed?.id !== id) toast(`Couldn’t get “${stub.title || 'this song'}” on this device — the next song will play`);
    missed = { id, at: performance.now() };
    room.patch({ unplayable: id });
    // Do not keep the last song running: the room has moved past it.
    if (st.isPlaying) st.togglePlay();
    return;
  }
  missed = null;
  if (room.unplayable) room.patch({ unplayable: null });
  if (st.queue[st.index]?.id === id) return;
  startInPlace(song);
  lastCorrection = trackStartedAt;
  playAttempts += 1;
}

function runGuest(code: string): () => void {
  let alive = true;
  let misses = 0;
  let ticks = 0;
  /** The server moment of the newest answer acted on. */
  let newest = 0;
  // Joining has already read the room once for this code; a session picked
  // up any other way (a reloaded tab) starts from nothing.
  if (clockCode !== code) {
    clock = new HostClock();
    clockCode = code;
    seekLead = new SeekLead();
    startLead = new SeekLead(0.5);
    landing = null;
  }
  const nudge = new RateNudge();
  const player = usePlayerStore.getState();
  player.setFollowMode(true);

  // Fine sync: between polls the host's playhead is projected locally, so the
  // guest can be compared with it several times a second.
  const fine = (): void => {
    const st = usePlayerStore.getState();
    const now = performance.now();
    const local = st.queue[st.index] ?? null;
    const together =
      clock.ready && clock.isPlaying && !!local && local.id === clock.songId && st.isPlaying && !st.isBuffering && audioEngine.isAdvancing() &&
      now - trackStartedAt >= TRACK_SETTLE_MS && now - lastCorrection >= CORRECTION_SETTLE_MS;
    if (!together) {
      nudge.reset();
      audioEngine.setRate(1);
      return;
    }
    const drift = playhead() - target(now);
    // The first look after a seek or a start: how late (or early) did it land?
    if (landing) {
      const landed = landing;
      landing = null;
      if (now - landed.at < LANDING_WINDOW_MS) landed.lead.learn(drift);
      // A song that came in well off (the first poll of a session is the
      // least exact, and a stream can be slow to start): one small seek now
      // beats ten seconds of catching up at a different speed.
      if (landed.lead === startLead && Math.abs(drift) > START_RESEEK_S && Math.abs(drift) <= SEEK_THRESHOLD_S * 3) {
        st.seek(inSong(target(now) + seekLead.seconds, st.duration));
        lastCorrection = now;
        landing = { lead: seekLead, at: now };
        nudge.reset();
        audioEngine.setRate(1);
        return;
      }
    }
    audioEngine.setRate(nudge.next(drift));
  };

  const tick = async (): Promise<void> => {
    ticks += 1;
    if (ticks % GUEST_HEARTBEAT_EVERY === 1) void heartbeat(code);
    const d = await getRoom(code);
    if (!alive) return;
    const store = useTogether.getState();
    if (!d) {
      misses += 1;
      if (misses >= 3) store.patch({ status: 'reconnecting' });
      return;
    }
    misses = 0;
    // On a bad connection an answer can arrive after a later one. Acting on it
    // would undo the newer state: a guest played on for two seconds after the
    // host had paused, then stopped again.
    if (typeof d.now === 'number') {
      if (d.now < newest) return;
      newest = d.now;
    }
    const r = d.room;
    if (!r) {
      toast('The host ended the session');
      store.reset();
      return;
    }
    store.patch({
      members: d.members ?? [],
      names: d.names ?? d.members ?? [],
      listenerCount: d.memberCount ?? d.members?.length ?? 1,
      hostName: r.host_name ?? null,
      queue: r.queue ?? [],
      hostSong: r.song ?? null,
      messages: r.messages ?? [],
      skipVotes: r.skipVotes ?? 0,
      status: hostIsAway({ updated_at: r.updated_at, now: d.now }) ? 'host-away' : 'live',
    });
    floatReactions(d.reactions);
    if (!r.song) return;
    clock.ingest({ position: r.position, playing: r.playing, updated_at: r.updated_at, now: d.now, took: d.took, rttMs: d.rttMs, receivedAt: d.receivedAt, songId: r.song.id });

    const st = usePlayerStore.getState();
    const local = st.queue[st.index] ?? null;
    if (local?.id === r.song.id) rememberPlayed(local);
    const now = performance.now();
    const c = decideCorrection({
      hostSongId: r.song.id,
      hostPlaying: r.playing,
      expected: target(now),
      local: {
        songId: local?.id ?? null,
        isPlaying: st.isPlaying,
        isBuffering: st.isBuffering,
        currentTime: playhead(),
        duration: st.duration,
      },
      sinceLastCorrectionMs: now - lastCorrection,
      sinceTrackStartMs: now - trackStartedAt,
      seekLeadS: seekLead.seconds,
    });
    store.patch({ drift: c.drift });

    switch (c.kind) {
      case 'load':
        // The room names the song; this device fetches its own stream.
        void loadHostSong(r.song);
        break;
      case 'play': {
        // The host has been playing since before this poll: start where it is
        // now (plus the moment a seek takes), not where this device stopped.
        const at = inSong(target(now) + seekLead.seconds, st.duration);
        if (Math.abs(playhead() - at) > IN_PLACE_S) {
          st.seek(at);
          landing = { lead: seekLead, at: now };
        }
        if (!st.isPlaying) st.togglePlay();
        lastCorrection = now;
        playAttempts += 1;
        break;
      }
      case 'pause': {
        if (st.isPlaying) st.togglePlay();
        // This device heard of the pause a moment late and played on: step
        // back to where the host stopped. Silent, since nothing is playing.
        const at = inSong(target(now), st.duration);
        if (Math.abs(playhead() - at) > IN_PLACE_S) st.seek(at);
        landing = null;
        lastCorrection = now;
        break;
      }
      case 'seek':
        st.seek(c.to);
        lastCorrection = now;
        // Only a seek that aimed ahead of a playing host teaches the lead.
        landing = r.playing ? { lead: seekLead, at: now } : null;
        break;
      default:
        break;
    }

    // The host is playing, we asked the player to play twice and it still
    // isn't (and isn't buffering): the browser is holding audio for a tap.
    const after = usePlayerStore.getState();
    if (after.isPlaying || !r.playing) {
      playAttempts = 0;
      if (useTogether.getState().needsTap) store.patch({ needsTap: false });
    } else if (playAttempts >= 2 && !after.isBuffering && !useTogether.getState().needsTap) {
      store.patch({ needsTap: true });
    }
  };

  void tick();
  const iv = window.setInterval(() => void tick(), GUEST_POLL_MS);
  const fineIv = window.setInterval(fine, FINE_SYNC_MS);
  const onHide = (e: PageTransitionEvent): void => {
    // A real close (not a bfcache freeze): free our seat right away instead
    // of counting us as listening for another 12 s.
    if (!e.persisted) leaveRoomBeacon(code);
  };
  window.addEventListener('pagehide', onHide);
  return () => {
    alive = false;
    window.clearInterval(iv);
    window.clearInterval(fineIv);
    window.removeEventListener('pagehide', onHide);
    // Back to the listener's own playback speed.
    audioEngine.setRate(usePlayerStore.getState().rate || 1);
    usePlayerStore.getState().setFollowMode(false);
  };
}

/** Must run inside a tap: starts the host's song at the host's position. */
export function tapToListen(): void {
  const { hostSong } = useTogether.getState();
  const st = usePlayerStore.getState();
  const local = st.queue[st.index] ?? null;
  if (hostSong && local?.id !== hostSong.id) {
    // Already looked up: start it inside this tap. Otherwise look it up now
    // (a tap is also "try again" for a song that could not be found).
    const ready = isPlayable(hostSong) ? hostSong : songCache.get(hostSong.id);
    if (ready) {
      startInPlace(ready);
    } else {
      missed = null;
      void loadHostSong(hostSong);
    }
  } else if (!st.isPlaying) {
    st.togglePlay();
  }
  lastCorrection = 0; // let the next tick align the position straight away
  playAttempts = 0;
  useTogether.getState().patch({ needsTap: false });
}

// --------------------------------------------------------------- control

/** Starts the engine for the current session; returns its stop function. */
export function runSession(mode: 'host' | 'guest', code: string): () => void {
  feed = new ReactionFeed();
  lastCorrection = 0;
  trackStartedAt = 0;
  playAttempts = 0;
  missed = null;
  // `landing` is left alone: joining may already have started the song, a
  // moment before this engine was mounted, and its landing is still to be measured.
  return mode === 'host' ? runHost(code) : runGuest(code);
}

export type HostStart = { ok: true } | { ok: false; message: string };

export async function startHosting(current: Song | null): Promise<HostStart> {
  const r = await createRoom(current);
  if (!r.code) {
    return {
      ok: false,
      message:
        r.reason === 'needs_migration' || r.reason === 'not_configured'
          ? 'Sessions aren’t set up on the server yet — the owner needs to run the rooms database update.'
          : r.reason === 'rate_limited'
            ? 'Too many tries — wait a minute and try again.'
            : 'Couldn’t start a session — check your connection and try again.',
    };
  }
  useTogether.getState().begin('host', r.code);
  return { ok: true };
}

export type JoinResult = { ok: true } | { ok: false; message: string };

/** Join a room. Call from a tap when possible: playback starts inside it. */
export async function joinSession(rawCode: string): Promise<JoinResult> {
  const code = rawCode.trim().toUpperCase();
  if (!/^[A-Z0-9]{4,8}$/.test(code)) return { ok: false, message: 'Enter the 6-character room code' };
  // Your own room (e.g. reopened on another tab): rejoin as its host.
  if (isHostOf(code)) {
    const d = await getRoom(code);
    if (!d?.room) return { ok: false, message: 'That session has ended' };
    useTogether.getState().begin('host', code);
    return { ok: true };
  }
  const d = await getRoom(code);
  if (!d) return { ok: false, message: 'Couldn’t reach the session — check your connection' };
  if (!d.room) return { ok: false, message: 'No live session with that code — it may have ended' };
  // Follow mode BEFORE the first play: the queue must not start auto-extending.
  usePlayerStore.getState().setFollowMode(true);
  useTogether.getState().begin('guest', code);
  useTogether.getState().patch({ hostName: d.room.host_name ?? null, hostSong: d.room.song ?? null });
  // Where the host is right now, so the song can start there and not at 0:00.
  clock = new HostClock();
  clockCode = code;
  seekLead = new SeekLead();
  startLead = new SeekLead(0.5);
  landing = null;
  if (d.room.song) {
    clock.ingest({ position: d.room.position, playing: d.room.playing, updated_at: d.room.updated_at, now: d.now, took: d.took, rttMs: d.rttMs, receivedAt: d.receivedAt, songId: d.room.song.id });
  }
  // You are in the room now; the song starts as soon as this device has it.
  missed = null;
  if (d.room.song) void loadHostSong(d.room.song);
  return { ok: true };
}

export function leaveSession(): void {
  const { mode, code } = useTogether.getState();
  if (code) void (mode === 'host' ? endRoom(code) : leaveRoom(code));
  clockCode = null;
  landing = null;
  useTogether.getState().reset();
}

/** Guest asks for a song; host just queues it. Returns a message for a toast. */
export async function addSong(song: Song): Promise<string> {
  const { mode, code } = useTogether.getState();
  if (mode === 'host') {
    usePlayerStore.getState().enqueue(song);
    return `Added “${song.title}” for everyone`;
  }
  const ok = await requestSong(code, song);
  return ok ? `Sent — “${song.title}” joins the queue in a moment` : `Couldn’t send “${song.title}” — try again`;
}

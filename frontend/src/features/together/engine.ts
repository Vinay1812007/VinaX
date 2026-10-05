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
 */
import { getSong } from '@/services/api';
import {
  createRoom,
  endRoom,
  getRoom,
  heartbeat,
  isHostOf,
  leaveRoom,
  leaveRoomBeacon,
  requestSong,
  sendReaction,
  updateRoom,
  type RoomTrack,
} from '@/services/together';
import { useTogether } from '@/services/together/session';
import { usePlayerStore } from '@/store/playerStore';
import { toast } from '@/store/toastStore';
import type { Song } from '@/types';
import { decideCorrection, HostClock, hostIsAway, ReactionFeed } from './sync';

const HOST_POLL_MS = 4000;
const GUEST_POLL_MS = 2000;
/** Guests heartbeat every third poll — the server counts a member as present
 *  for 12 s, and halving the POSTs keeps a houseful of phones on one Wi-Fi
 *  inside the per-address budget. */
const GUEST_HEARTBEAT_EVERY = 3;

let feed = new ReactionFeed();

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

async function fullSong(stub: Song): Promise<Song | null> {
  // A stub from a guest has no stream URL; a real Song from the catalogue does.
  if (Array.isArray(stub.audio) && stub.audio.length) return stub;
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
    const r = await updateRoom(code, s.queue[s.index] ?? null, s.currentTime, s.isPlaying, up, [...consumed]);
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

  let last = '';
  let lastT = usePlayerStore.getState().currentTime;
  let lastW = Date.now();
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
    if (key !== last || jumped) {
      last = key;
      void push();
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
    if (!d.room) {
      toast('This session has ended');
      useTogether.getState().reset();
      return;
    }
    useTogether.getState().patch({
      members: d.members ?? [],
      listenerCount: d.memberCount ?? d.members?.length ?? 1,
    });
    floatReactions(d.reactions);
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
  };
}

// ----------------------------------------------------------------- guest

let lastCorrection = 0;
let trackStartedAt = 0;
let playAttempts = 0;

function runGuest(code: string): () => void {
  let alive = true;
  let misses = 0;
  let ticks = 0;
  const clock = new HostClock();
  const player = usePlayerStore.getState();
  player.setFollowMode(true);

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
    const r = d.room;
    if (!r) {
      toast('The host ended the session');
      store.reset();
      return;
    }
    store.patch({
      members: d.members ?? [],
      listenerCount: d.memberCount ?? d.members?.length ?? 1,
      hostName: r.host_name ?? null,
      queue: r.queue ?? [],
      hostSong: r.song ?? null,
      status: hostIsAway({ updated_at: r.updated_at, now: d.now }) ? 'host-away' : 'live',
    });
    floatReactions(d.reactions);
    if (!r.song) return;
    clock.ingest({ position: r.position, playing: r.playing, updated_at: r.updated_at, now: d.now, rttMs: d.rttMs, receivedAt: d.receivedAt });

    const st = usePlayerStore.getState();
    const local = st.queue[st.index] ?? null;
    const now = performance.now();
    const c = decideCorrection({
      hostSongId: r.song.id,
      hostPlaying: r.playing,
      expected: clock.positionAt(now),
      local: {
        songId: local?.id ?? null,
        isPlaying: st.isPlaying,
        isBuffering: st.isBuffering,
        currentTime: st.currentTime,
        duration: st.duration,
      },
      sinceLastCorrectionMs: now - lastCorrection,
      sinceTrackStartMs: now - trackStartedAt,
    });
    store.patch({ drift: c.drift });

    switch (c.kind) {
      case 'load':
        st.playSong(r.song);
        trackStartedAt = now;
        lastCorrection = now;
        playAttempts += 1;
        break;
      case 'play':
        if (!st.isPlaying) st.togglePlay();
        lastCorrection = now;
        playAttempts += 1;
        break;
      case 'pause':
        if (st.isPlaying) st.togglePlay();
        lastCorrection = now;
        break;
      case 'seek':
        st.seek(c.to);
        lastCorrection = now;
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
  const onHide = (e: PageTransitionEvent): void => {
    // A real close (not a bfcache freeze): free our seat right away instead
    // of counting us as listening for another 12 s.
    if (!e.persisted) leaveRoomBeacon(code);
  };
  window.addEventListener('pagehide', onHide);
  return () => {
    alive = false;
    window.clearInterval(iv);
    window.removeEventListener('pagehide', onHide);
    usePlayerStore.getState().setFollowMode(false);
  };
}

/** Must run inside a tap: starts the host's song at the host's position. */
export function tapToListen(): void {
  const { hostSong } = useTogether.getState();
  const st = usePlayerStore.getState();
  const local = st.queue[st.index] ?? null;
  if (hostSong && local?.id !== hostSong.id) {
    st.playSong(hostSong);
    trackStartedAt = performance.now();
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
  if (d.room.song) {
    usePlayerStore.getState().playSong(d.room.song);
    trackStartedAt = performance.now();
  }
  useTogether.getState().begin('guest', code);
  useTogether.getState().patch({ hostName: d.room.host_name ?? null, hostSong: d.room.song ?? null });
  return { ok: true };
}

export function leaveSession(): void {
  const { mode, code } = useTogether.getState();
  if (code) void (mode === 'host' ? endRoom(code) : leaveRoom(code));
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

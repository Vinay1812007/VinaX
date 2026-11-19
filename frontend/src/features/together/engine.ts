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
 * 1.13 — the live line (live.ts). Polling made everything wait for a phone's
 * next poll: a pause was heard two seconds late, a chat line took up to four.
 * Now the host also SAYS each change on the room's live line the instant it
 * happens, with the server moment its playhead was read at, and a guest acts
 * on it at once (`liveState`); chat lines, "typing" and reactions travel the
 * same way. Every write still goes to the server and every phone still polls
 * it: the poll is the truth, the line is the shortcut. A poll that is older
 * than what the line just said is not allowed to undo it.
 *
 * 1.14 — a jam, like Spotify's. Everyone adds songs straight to the shared
 * queue (no asking), and takes out what they added; guests play, pause and
 * skip for everyone unless the host turns that off; the host can remove
 * someone; and a guest can let only the host's speaker play, with this phone
 * as the remote. The host's app still owns the music: a guest's command goes
 * to the server (which checks who sent it), the host's app reads it at once
 * (the guest pokes it on the live line) and does it, and everyone follows.
 *
 * The room only NAMES a song (id, title, artwork): the server keeps no stream
 * URLs. So a guest looks the host's song up in the catalogue before playing
 * it, exactly as the host does for a guest's request. Guests used to hand the
 * room's stub straight to the player, which cannot play a song without
 * streams: joining failed and nobody but the host heard anything.
 */
import { getSong } from '@/services/api';
import { audioEngine, orderedSources } from '@/services/audio/engine';
import { useSettingsStore } from '@/store/settingsStore';
import {
  createRoom,
  endRoom,
  getRoom,
  heartbeat,
  isHostOf,
  leaveRoom,
  leaveRoomBeacon,
  myName,
  REACTION_EMOJI,
  removePerson,
  requestSong,
  sayInRoom,
  sendControl,
  sendReaction,
  updateRoom,
  voteSkip,
  type ControlResult,
  type JamCmd,
  type RoomControl,
  type RoomPoll,
  type RoomTrack,
} from '@/services/together';
import { useTogether } from '@/services/together/session';
import { asRoom, setRoomAsk, setRoomControl, usePlayerStore, type RoomCmd } from '@/store/playerStore';
import { toast } from '@/store/toastStore';
import { bestImage } from '@/utils/images';
import type { Song } from '@/types';
import { KEYS } from '@/constants/storage-keys';
import { getLocal, setLocal } from '@/services/storage/local';
import { decideCorrection, HostClock, hostIsAway, RateNudge, ReactionFeed, SEEK_THRESHOLD_S, SeekLead, ServerClock, TRACK_SETTLE_MS } from './sync';
import { cleanLive, LiveLine } from './live';
import { chatShown, lineKey, noteChat, resetUnread, useRoom } from './room';

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

// ------------------------------------------------------------ live line

/** The room's live line, while a session runs and the server has one. */
let line: LiveLine | null = null;
let lineCode = '';
/** What this session does with the host's state and a "look now" (set by runHost / runGuest). */
let liveState: ((raw: unknown) => void) | null = null;
let livePoke: (() => void) | null = null;

/** Opens the live line for `code` once the server has said where it is. */
function ensureLine(code: string, raw: unknown): void {
  if (line && lineCode === code) return;
  const cfg = cleanLive(raw);
  if (!cfg || typeof WebSocket === 'undefined') return;
  line?.close();
  lineCode = code;
  line = new LiveLine(cfg, code, onLive, (open) => useRoom.getState().patch({ online: open }));
}

function dropLine(): void {
  line?.close();
  line = null;
  lineCode = '';
  liveState = null;
  livePoke = null;
}

const text = (v: unknown, max: number): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const LINE_ID = /^[A-Za-z0-9_-]{6,24}$/;

/** Everything arriving on the line is from another phone: checked like any stranger's input. */
function onLive(event: string, raw: unknown): void {
  const p = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const room = useRoom.getState();
  if (event === 'state') {
    liveState?.(raw);
  } else if (event === 'poke') {
    livePoke?.();
  } else if (event === 'chat') {
    const id = text(p.id, 24);
    const words = text(p.text, 200);
    const by = text(p.by, 40) || 'Someone';
    if (!LINE_ID.test(id) || !words) return;
    room.setTyping(by, false);
    unread(noteChat([{ key: id, mine: false }], false));
    if (useTogether.getState().messages.some((m) => m.id === id)) return;
    room.line({ id, by, text: words, at: Date.now(), mine: false, state: 'sent' });
  } else if (event === 'typing') {
    const by = text(p.by, 40);
    if (by) room.setTyping(by, p.on !== false);
  } else if (event === 'react') {
    const e = text(p.e, 8);
    if (!(REACTION_EMOJI as readonly string[]).includes(e)) return;
    // The same reaction comes back in the next poll: it is already on screen.
    feed.sent(e);
    room.float([e], text(p.by, 40) || null);
  }
}

/** The chat lines this tab has sent (kept for the tab, so they stay "mine" after a reload). */
const SENT_KEY = 'vinax.together.sent.v1';
let sentIds: Set<string> | null = null;
export function sentLines(): Set<string> {
  if (sentIds) return sentIds;
  try {
    const raw = JSON.parse(sessionStorage.getItem(SENT_KEY) ?? '[]') as unknown;
    sentIds = new Set(Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string').slice(-80) : []);
  } catch {
    sentIds = new Set();
  }
  return sentIds;
}
function rememberSent(id: string): void {
  const ids = sentLines();
  ids.add(id);
  try {
    sessionStorage.setItem(SENT_KEY, JSON.stringify([...ids].slice(-80)));
  } catch {
    /* storage blocked: lines just stop being "mine" after a reload */
  }
}

const newLineId = (): string => {
  const a = new Uint8Array(9);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 16);
};

/**
 * 15.0 — say something to the room. 1.13: the line is on this screen at once,
 * goes to everyone on the live line, and is stored by the server for whoever
 * polls or joins later. It failed only if neither took it.
 */
export async function say(words: string, retryId?: string): Promise<boolean> {
  const { code } = useTogether.getState();
  const clean = words.trim().slice(0, 200);
  if (!code || !clean) return false;
  const room = useRoom.getState();
  const id = retryId ?? newLineId();
  const by = myName();
  rememberSent(id);
  noteChat([{ key: id, mine: true }], false);
  if (retryId) room.mark(id, 'sending');
  else room.line({ id, by, text: clean, at: Date.now(), mine: true, state: 'sending' });
  typingStopped();
  const heard = line?.send('chat', { id, by, text: clean }) ?? false;
  const stored = await sayInRoom(code, clean, id);
  useRoom.getState().mark(id, stored || heard ? 'sent' : 'failed');
  return stored || heard;
}

/** How often "typing" is repeated while the listener keeps typing (ms). */
const TYPING_EVERY_MS = 2500;
let typingSaid = 0;

/** The chat field changed: tell the room this listener is typing (the live line only). */
export function typing(hasText: boolean): void {
  if (!hasText) {
    typingStopped();
    return;
  }
  const now = Date.now();
  if (now - typingSaid < TYPING_EVERY_MS) return;
  if (line?.send('typing', { by: myName() })) typingSaid = now;
}
function typingStopped(): void {
  if (!typingSaid) return;
  typingSaid = 0;
  line?.send('typing', { by: myName(), on: false });
}

/** 15.0 — vote to skip what is playing. The host simply skips; so does a guest
 *  while the host lets guests control playback (1.14). */
export async function voteToSkip(): Promise<void> {
  const st = useTogether.getState();
  if (!st.code) return;
  if (st.mode === 'host') { usePlayerStore.getState().next(true); return; }
  if (st.guestControl) { control('next'); return; }
  const song = st.hostSong;
  if (!song) return;
  const n = await voteSkip(st.code, song.id);
  if (n === null) toast('Could not send your vote');
  else {
    st.patch({ skipVotes: n });
    toast(`Vote to skip: ${n}`);
    // The host counts votes when it next reads the room: ask it to read now.
    line?.send('poke', {});
  }
}

function floatReactions(list: Array<{ e: string; at: string }> | undefined): void {
  const fresh = feed.ingest(list);
  if (fresh.length) useRoom.getState().float(fresh);
}

/** Tap a reaction: it rises here at once and, on the live line, on every
 *  other screen in the room; the poll's echo of it is skipped. */
export function react(emoji: string): void {
  const { code } = useTogether.getState();
  if (!code) return;
  feed.sent(emoji);
  useRoom.getState().float([emoji]);
  line?.send('react', { e: emoji, by: myName() });
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

/** Host: push the room's state now (set while hosting). */
let hostPush: (() => void) | null = null;
/** Host: read the room now (set while hosting). */
let hostPoll: (() => void) | null = null;

/** A guest's command older than this (ms, server clock) is not carried out: a host that reloads must not replay a pause. */
const CONTROL_FRESH_MS = 10_000;
/** …a song a guest added stays good for longer: it is added once whenever it is read. */
const ADD_FRESH_MS = 90_000;

/** Who added a song to the queue, and their handle (they may take it out again). */
const addedBy = new Map<string, { by: string; h: string | null }>();

function runHost(code: string): () => void {
  let alive = true;
  // The server's clock, from the host's own polls: every push says at which
  // server moment its position was read.
  const server = new ServerClock();
  addedBy.clear();
  const done = new Set<string>();
  const consumed = new Set<string>();
  const adopting = new Set<string>();
  let inFlight = false;
  let again = false;

  const upNext = (): RoomTrack[] => {
    const s = usePlayerStore.getState();
    return s.queue.slice(s.index + 1, s.index + 9).map((sg) => {
      const who = addedBy.get(sg.id);
      return { song: sg, by: who?.by ?? null, ...(who?.h ? { h: who.h } : {}) };
    });
  };

  // One push in flight at a time; a change during it schedules exactly one more.
  const push = async (): Promise<void> => {
    const s = usePlayerStore.getState();
    // The playhead and the moment it was read, taken together.
    const position = playhead();
    const read = performance.now();
    const at = server.ready ? server.at(read) : undefined;
    // 1.13 — said on the live line first, and whether or not a push is on
    // its way: guests act on this now, and the server catches up behind it.
    if (at !== undefined && line?.connected) {
      const song = s.queue[s.index] ?? null;
      line.send('state', { song: song ? roomStub(song) : null, position, playing: s.isPlaying, at });
    }
    if (inFlight) {
      again = true;
      return;
    }
    inFlight = true;
    const up = upNext();
    useTogether.getState().patch({ queue: up });
    const r = await updateRoom(code, s.queue[s.index] ?? null, position, s.isPlaying, up, [...consumed], at, { guestControl: useTogether.getState().guestControl });
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
    addedBy.set(song.id, { by: who, h: t.h ?? null });
    usePlayerStore.getState().enqueue(song, { quiet: true });
    // The song is in Up next; the host can also bring it on now.
    toast(`${who} added “${song.title}”`, { image: bestImage(song.images, 100), duration: 8000, action: { label: 'Play now', onClick: () => playNow(song.id) } });
  };

  /** 1.14 — a guest's command, carried out once. */
  const carryOut = async (c: RoomControl, serverNow: number | undefined): Promise<void> => {
    if (!c || typeof c.id !== 'string' || done.has(c.id)) return;
    done.add(c.id);
    const age = typeof serverNow === 'number' ? serverNow - Date.parse(c.at) : 0;
    if (!Number.isFinite(age) || age > (c.cmd === 'add' ? ADD_FRESH_MS : CONTROL_FRESH_MS)) return;
    const st = usePlayerStore.getState();
    const who = c.by || 'Someone';
    if (c.cmd === 'add' && c.song?.id) {
      const stub = c.song;
      const upcoming = (): boolean => {
        const p = usePlayerStore.getState();
        return p.queue.slice(p.index).some((x) => x.id === stub.id);
      };
      if (upcoming()) return;
      const song = await fullSong(stub);
      if (!alive || upcoming()) return;
      if (!song) {
        toast(`Couldn’t add “${stub.title}” from ${who} — it isn’t available`);
        return;
      }
      // The player keeps one copy of a song, played ones included: one that has
      // already played this session is not added again, and the host is told so.
      if (usePlayerStore.getState().queue.some((x) => x.id === song.id)) {
        toast(`${who} asked for “${song.title}” again — it has already played`, { key: `lt-add-${song.id}` });
        return;
      }
      addedBy.set(song.id, { by: who, h: c.h });
      usePlayerStore.getState().enqueue(song, { quiet: true });
      toast(`${who} added “${song.title}”`, { image: bestImage(song.images, 100), duration: 6000, key: `lt-add-${song.id}`, action: { label: 'Play now', onClick: () => playNow(song.id) } });
      void push();
      return;
    }
    if (c.cmd === 'remove' && c.songId) {
      const i = st.queue.findIndex((x, n) => n > st.index && x.id === c.songId);
      // A guest takes out only a song they added.
      if (i < 0 || addedBy.get(c.songId)?.h !== c.h) return;
      const title = st.queue[i].title;
      st.removeAt(i);
      addedBy.delete(c.songId);
      toast(`${who} took out “${title}”`, { key: 'lt-ctl' });
      void push();
      return;
    }
    // Playback: only while the host lets guests control it (the server checked
    // when the command came in; the host may have turned it off since).
    if (!useTogether.getState().guestControl) return;
    if (c.cmd === 'play' && !st.isPlaying) st.togglePlay();
    else if (c.cmd === 'pause' && st.isPlaying) st.togglePlay();
    else if (c.cmd === 'next') st.next(true);
    else if (c.cmd === 'prev') st.prev();
    else return;
    const said = { play: 'played the music', pause: 'paused', next: 'skipped to the next song', prev: 'went back a song' }[c.cmd];
    toast(`${who} ${said}`, { key: 'lt-ctl' });
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
    ensureLine(code, d.live);
    useTogether.getState().patch({
      members: d.members ?? [],
      names: d.names ?? d.members ?? [],
      listenerCount: d.memberCount ?? d.members?.length ?? 1,
      messages: d.room.messages ?? [],
      skipVotes: d.room.skipVotes ?? 0,
      people: d.people ?? [],
      me: d.me ?? null,
      hostH: d.me ?? null,
    });
    // 1.14 — the guests' commands, in the order they came.
    for (const c of d.controls ?? []) await carryOut(c, d.now);
    chatListed(d.room.messages);
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
  hostPush = () => void push();
  hostPoll = () => void poll();
  const iv = window.setInterval(() => void poll(), HOST_POLL_MS);
  // A guest asked for a song or voted to skip: read the room now, not in four seconds.
  let poked = -POKE_GAP_MS;
  livePoke = () => {
    const now = performance.now();
    if (now - poked < POKE_GAP_MS) return;
    poked = now;
    void poll();
  };
  return () => {
    alive = false;
    unsub();
    window.clearInterval(iv);
    window.clearInterval(watch);
    hostPush = null;
    hostPoll = null;
    dropLine();
  };
}

/** A phone reads the room for a "look now" at most this often (ms). */
const POKE_GAP_MS = 700;

/** Drop the chat lines in flight that the server now lists; count the new ones from others as unread (1.14). */
function chatListed(messages: Array<{ id?: string; at: string; by: string; text: string }> | undefined): void {
  const list = messages ?? [];
  const ids = new Set(list.map((m) => m.id).filter((x): x is string => !!x));
  if (ids.size) useRoom.getState().listed(ids);
  const mine = sentLines();
  unread(noteChat(list.map((m) => ({ key: lineKey(m), mine: !!m.id && mine.has(m.id) })), true));
}

/** 1.14 — add to the unread count shown on the Live pill and the Together tab. */
function unread(n: number): void {
  if (n > 0) useTogether.getState().patch({ unread: Math.min(99, useTogether.getState().unread + n) });
}

/**
 * 1.14 — a chat is on screen (the room page or the player's Together tab):
 * the unread count clears and stays clear while it is. Returns the function
 * to call when the chat leaves the screen.
 */
export function openChat(): () => void {
  const closed = chatShown();
  if (useTogether.getState().unread) useTogether.getState().patch({ unread: 0 });
  return closed;
}

/** A song as the live line carries it: what a room shows, never a stream. */
function roomStub(song: Song): Partial<Song> {
  return { id: song.id, title: song.title, subtitle: song.subtitle, images: (song.images ?? []).slice(0, 4), duration: song.duration };
}

/** The host's state as it arrived on the live line, or null when it is not one. */
function cleanState(raw: unknown): { song: Song | null; position: number; playing: boolean; at: number } | null {
  const p = raw as { song?: unknown; position?: unknown; playing?: unknown; at?: unknown } | null;
  if (!p || typeof p.position !== 'number' || !Number.isFinite(p.position) || p.position < 0 || typeof p.at !== 'number' || !Number.isFinite(p.at)) return null;
  const s = p.song as Record<string, unknown> | null;
  let song: Song | null = null;
  if (s && typeof s === 'object') {
    const id = text(s.id, 64);
    if (!id) return null;
    // Only what a room shows is taken; a stream address on the line is ignored.
    const images = Array.isArray(s.images)
      ? (s.images as unknown[]).slice(0, 4).filter((i): i is { quality: string; url: string } => !!i && typeof (i as { url?: unknown }).url === 'string' && /^https:\/\//.test((i as { url: string }).url))
      : [];
    song = { id, title: text(s.title, 200), subtitle: text(s.subtitle, 200), images, duration: typeof s.duration === 'number' && Number.isFinite(s.duration) ? s.duration : 0 } as unknown as Song;
  }
  return { song, position: p.position, playing: p.playing === true, at: p.at };
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

/** The most a device can be fine-tuned either way (ms). 1.14: 2 s (it was 0.5 s), for a speaker or TV that is slow to sound. */
export const TRIM_MAX_MS = 2000;
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
/** A play heard on the live line this close (seconds) to the host starts where it is. */
const RESUME_IN_PLACE_S = 0.15;

/** A seek target kept inside the song. */
function inSong(seconds: number, duration: number): number {
  return Math.max(0, duration > 1 ? Math.min(seconds, duration - 0.5) : seconds);
}

/** Guest: start `song` where the host is, and note the start so its landing is measured. */
function startInPlace(song: Song): void {
  const at = startPosition(song.id);
  // `room`: this play is the room's, not a song the listener tapped (see ask()).
  usePlayerStore.getState().playSong(song, { startAt: at, room: true });
  trackStartedAt = performance.now();
  landing = at > 0 && clock.isPlaying ? { lead: startLead, at: trackStartedAt } : null;
}

/**
 * Guest: get the host's song from the catalogue and start it. The room may
 * have moved on (or ended) while the lookup was in flight; then nothing plays.
 */
async function loadHostSong(stub: Song): Promise<void> {
  const id = stub.id;
  // 1.14 — only the host's speaker plays: this phone is the remote.
  if (!useTogether.getState().onThisPhone) return;
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
    if (st.isPlaying) asRoom(() => st.togglePlay());
    return;
  }
  missed = null;
  if (room.unplayable) room.patch({ unplayable: null });
  if (st.queue[st.index]?.id === id) return;
  startInPlace(song);
  lastCorrection = trackStartedAt;
  playAttempts += 1;
}

/** For this long after the live line said something, a poll older than it is not believed (ms). */
const LIVE_HOLD_MS = 5000;
/** A state on the line is taken only if it was read about now on the server's
 *  clock: not from the future, not from long ago (ms). */
const LIVE_AHEAD_MS = 400;
const LIVE_OLD_MS = 15_000;

function runGuest(code: string): () => void {
  let alive = true;
  let misses = 0;
  let ticks = 0;
  /** The server moment of the newest answer acted on. */
  let newest = 0;
  /** The server moment of the newest state taken from the live line, and when it came. */
  let liveAt = 0;
  let liveSeen = 0;
  /** The server moment of the newest host push read from a poll. */
  let polledAt = 0;
  /** Songs up next that this device has already looked up. */
  const fetched = new Set<string>();
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
  // A song tapped or queued anywhere in the app goes into the room's queue.
  asked.clear();
  setRoomAsk((song) => void ask(song));
  // 1.14 — play, pause, next and previous, from anywhere in the app, are the room's.
  setRoomControl((cmd) => control(cmd));

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
    // 1.14 — the room page's sync check shows the offset as it is now, not as of the last poll.
    const shown = useTogether.getState().drift;
    if (shown === null || Math.abs(shown - drift) >= 0.005) useTogether.getState().patch({ drift });
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
    if (d.removed) {
      toast(`${r.host_name ?? 'The host'} removed you from this session`);
      store.reset();
      return;
    }
    ensureLine(code, d.live);
    // The live line has already said something newer than this answer holds
    // (the host's push to the server is still on its way): its playback part
    // would undo that for a moment, so only the rest of it is taken.
    const pushedAt = Date.parse(r.updated_at);
    const behind = liveAt > 0 && performance.now() - liveSeen < LIVE_HOLD_MS && Number.isFinite(pushedAt) && pushedAt < liveAt - 2;
    store.patch({
      members: d.members ?? [],
      names: d.names ?? d.members ?? [],
      listenerCount: d.memberCount ?? d.members?.length ?? 1,
      hostName: r.host_name ?? null,
      queue: r.queue ?? [],
      ...(behind ? {} : { hostSong: r.song ?? null, hostPlaying: r.playing === true }),
      messages: r.messages ?? [],
      skipVotes: r.skipVotes ?? 0,
      status: hostIsAway({ updated_at: r.updated_at, now: d.now }) ? 'host-away' : 'live',
      ...jamOf(d),
    });
    chatListed(r.messages);
    floatReactions(d.reactions);
    // The song after this one: look it up now, so that when the host moves on
    // only the audio is left to fetch.
    const next = r.queue?.[0]?.song;
    if (next?.id && !fetched.has(next.id)) {
      fetched.add(next.id);
      // 1.19 — and start buffering its audio: when the host moves on, this
      // phone has the first seconds already and comes in with the host
      // instead of a second or two behind (the gap phones felt most).
      void fullSong(next).then((song) => {
        if (song && alive && useTogether.getState().onThisPhone) audioEngine.preloadNext(orderedSources(song, useSettingsStore.getState().audioQuality)[0] ?? null);
      });
    }
    if (behind) {
      clock.sync(d);
      return;
    }
    if (!r.song) return;
    clock.ingest({ position: r.position, playing: r.playing, updated_at: r.updated_at, now: d.now, took: d.took, rttMs: d.rttMs, receivedAt: d.receivedAt, songId: r.song.id });
    if (Number.isFinite(pushedAt)) polledAt = pushedAt;
    follow(r.song, r.playing, false);
  };

  /** Put this device where the host is: load, play, pause or seek, as needed. */
  const follow = (song: Song, hostPlaying: boolean, urgent: boolean): void => {
    const store = useTogether.getState();
    const r = { song, playing: hostPlaying };
    const st = usePlayerStore.getState();
    // 1.14 — only the host's speaker plays: this phone stays quiet, as the remote.
    if (!store.onThisPhone) {
      if (st.isPlaying) asRoom(() => st.togglePlay());
      if (store.drift !== null || store.needsTap) store.patch({ drift: null, needsTap: false });
      return;
    }
    const local = st.queue[st.index] ?? null;
    if (local?.id === r.song.id) rememberPlayed(local);
    const now = performance.now();
    const c = decideCorrection({
      urgent,
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
        // 1.13 — heard on the live line a moment after the host pressed play,
        // this device is where the host paused and only that moment behind:
        // play now, and let the fine sync close the gap. A seek here would be
        // a silence longer than the gap it mends.
        const close = urgent && Math.abs(playhead() - target(now)) <= RESUME_IN_PLACE_S;
        if (!close && Math.abs(playhead() - at) > IN_PLACE_S) {
          st.seek(at);
          landing = { lead: seekLead, at: now };
        }
        if (!st.isPlaying) asRoom(() => st.togglePlay());
        lastCorrection = now;
        playAttempts += 1;
        break;
      }
      case 'pause': {
        if (st.isPlaying) asRoom(() => st.togglePlay());
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

  // 1.13 — the host's state, the instant the host said it on the live line.
  liveState = (raw) => {
    if (!alive) return;
    const m = cleanState(raw);
    const serverNow = clock.serverNow();
    // Not placeable yet (no poll has told this device the server's clock), or
    // not a moment that can be right: ask the server instead.
    if (!m || serverNow === null || m.at > serverNow + LIVE_AHEAD_MS || m.at < serverNow - LIVE_OLD_MS) {
      poke();
      return;
    }
    // Older than what this device already has, from the line or from a poll.
    if (m.at <= liveAt || m.at < polledAt - 2 || !m.song) return;
    if (!clock.pushed({ position: m.position, playing: m.playing, at: m.at, songId: m.song.id })) return;
    liveAt = m.at;
    liveSeen = performance.now();
    const store = useTogether.getState();
    if (store.hostSong?.id !== m.song.id) store.patch({ hostSong: m.song });
    if (store.hostPlaying !== m.playing) store.patch({ hostPlaying: m.playing });
    if (store.status !== 'live') store.patch({ status: 'live' });
    follow(m.song, m.playing, true);
  };
  let poked = -POKE_GAP_MS;
  const poke = (): void => {
    const now = performance.now();
    if (now - poked < POKE_GAP_MS) return;
    poked = now;
    void tick();
  };
  livePoke = poke;

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
    setRoomAsk(null);
    setRoomControl(null);
    dropLine();
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
    asRoom(() => st.togglePlay());
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
  typingSaid = 0;
  useRoom.getState().reset();
  resetUnread();
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

/** Add a song to the room's queue, from anyone. Returns a message for a toast. */
export async function addSong(song: Song): Promise<string> {
  const { mode, code, hostName, hostH } = useTogether.getState();
  if (mode === 'host') {
    usePlayerStore.getState().enqueue(song);
    return `Added “${song.title}” to the queue`;
  }
  asked.set(song.id, Date.now());
  // 1.14 — a jam host takes it straight into the queue; a host app older than
  // that (no handle) still takes it as a request.
  const ok = hostH ? (await sendControl(code, newLineId(), 'add', { song: roomStub(song) as Song })) === 'ok' : await requestSong(code, song);
  // The host adds it when it next reads the room: ask it to read now.
  if (ok) line?.send('poke', {});
  else asked.delete(song.id);
  if (!ok) return `Couldn’t add “${song.title}” — try again`;
  return hostH ? `Added “${song.title}” to the queue` : `Asked ${hostName ?? 'the host'} for “${song.title}” — it joins Up next in a moment`;
}

/** Guest: the songs asked for lately (id → when), so a second tap does not ask twice. */
const asked = new Map<string, number>();
const ASKED_AGAIN_MS = 60_000;

/**
 * 1.13 — a guest taps (or queues) a song anywhere in the app: Home, Search,
 * an album. The room's music plays from the host's app, so the tap adds the
 * song to the room's queue (1.14: straight in, as in a jam); before, the song
 * played here for a second and the room took it away.
 */
export async function ask(song: Song): Promise<void> {
  const st = useTogether.getState();
  if (st.mode !== 'guest') return;
  const image = bestImage(song.images, 100);
  if (st.hostSong?.id === song.id) {
    toast(`“${song.title}” is playing in the room now`, { image, key: 'lt-ask' });
    return;
  }
  if (st.queue.some((t) => t.song.id === song.id) || Date.now() - (asked.get(song.id) ?? 0) < ASKED_AGAIN_MS) {
    toast(`“${song.title}” is already in the room’s queue`, { image, key: 'lt-ask' });
    return;
  }
  toast(await addSong(song), { image, key: 'lt-ask' });
}

/** Host: bring a song that is up next on now (a guest's request, say). */
export function playNow(id: string): void {
  const st = usePlayerStore.getState();
  if (useTogether.getState().mode !== 'host') return;
  const i = st.queue.findIndex((s, n) => n > st.index && s.id === id);
  if (i > 0) st.playAt(i);
}

// ------------------------------------------------------------------- jam

/** 1.14 — the jam fields of a guest's poll. A host app older than 1.14 sends no handle: then guests vote to skip and ask for songs, as before. */
function jamOf(d: RoomPoll): { people: NonNullable<RoomPoll['people']>; me: string | null; hostH: string | null; guestControl: boolean } {
  const hostH = d.room?.hostH ?? null;
  return { people: d.people ?? [], me: d.me ?? null, hostH, guestControl: !!hostH && d.room?.guestControl !== false };
}

/** Guest: what a refused command means for the listener. */
function refused(r: ControlResult): void {
  const st = useTogether.getState();
  if (r === 'no_control') {
    st.patch({ guestControl: false });
    toast(`${st.hostName ?? 'The host'} is in charge of playback in this session`, { key: 'lt-ctl' });
  } else if (r === 'removed') {
    toast(`${st.hostName ?? 'The host'} removed you from this session`);
    st.reset();
  } else if (r === 'gone') {
    toast('The host ended the session');
    st.reset();
  } else if (r === 'error') {
    toast('Couldn’t reach the room — try again', { key: 'lt-ctl' });
  }
}

/**
 * 1.14 — a guest plays, pauses or skips, for everyone: the player's buttons,
 * the lock screen and the room's own buttons all come here while following.
 * The host's app does it; everyone, this phone too, then follows the host.
 */
export function control(cmd: RoomCmd | 'play' | 'pause'): void {
  const st = useTogether.getState();
  if (st.mode !== 'guest' || !st.code) return;
  // Play or pause is about the HOST's music, which may differ from this phone's for a moment.
  const hostPlaying = clock.ready ? clock.isPlaying : st.hostPlaying;
  // This phone is out of step with the room (the browser held its audio, or
  // it played on a moment after a pause): the tap puts THIS phone right, it
  // does not stop or start the music for everyone.
  const local = usePlayerStore.getState();
  if (cmd === 'toggle' && st.onThisPhone && local.isPlaying !== hostPlaying) {
    if (hostPlaying) tapToListen();
    else asRoom(() => local.togglePlay());
    return;
  }
  if (!st.guestControl) {
    toast(`${st.hostName ?? 'The host'} is in charge of playback in this session`, { key: 'lt-ctl' });
    return;
  }
  const jc: JamCmd = cmd === 'toggle' ? (hostPlaying ? 'pause' : 'play') : cmd;
  void sendControl(st.code, newLineId(), jc).then((r) => {
    // The host carries commands out when it next reads the room: ask it to read now.
    if (r === 'ok') line?.send('poke', {});
    else refused(r);
  });
}

/** Whether this device may take `track` out of the queue: the host, any; a guest, what they added. */
export function canTakeOut(track: RoomTrack): boolean {
  const st = useTogether.getState();
  if (st.mode === 'host') return true;
  return !!st.hostH && !!st.me && track.h === st.me;
}

/** 1.14 — take a song out of the room's queue. */
export function takeOut(track: RoomTrack): void {
  const st = useTogether.getState();
  if (!canTakeOut(track)) return;
  if (st.mode === 'host') {
    const p = usePlayerStore.getState();
    const i = p.queue.findIndex((x, n) => n > p.index && x.id === track.song.id);
    if (i < 0) return;
    p.removeAt(i);
    addedBy.delete(track.song.id);
    toast(`Took out “${track.song.title}”`, { key: 'lt-ctl' });
    return;
  }
  // Out of this phone's list at once; the host's next push confirms it.
  st.patch({ queue: st.queue.filter((t) => t.song.id !== track.song.id) });
  void sendControl(st.code, newLineId(), 'remove', { songId: track.song.id }).then((r) => {
    if (r === 'ok') line?.send('poke', {});
    else refused(r);
  });
}

/** 1.14 — host: let guests play, pause and skip, or not. */
export function setGuestControl(on: boolean): void {
  const st = useTogether.getState();
  if (st.mode !== 'host') return;
  st.patch({ guestControl: on });
  hostPush?.();
  toast(on ? 'Everyone can play, pause and skip' : 'Only you control playback now', { key: 'lt-ctl' });
}

/** 1.14 — host: take someone out of the room. */
export async function removeFromRoom(h: string, name: string): Promise<void> {
  const st = useTogether.getState();
  if (st.mode !== 'host' || h === st.me) return;
  const ok = await removePerson(st.code, h);
  toast(ok ? `Removed ${name} from the session` : `Couldn’t remove ${name} — try again`);
  if (ok) {
    st.patch({ people: useTogether.getState().people.filter((p) => p.h !== h) });
    hostPoll?.();
  }
}

/**
 * 1.14 — guest: play the room on this phone, or let only the host's speaker
 * play and use this phone as the remote. Call from a tap: turning it back on
 * starts the host's song inside it.
 */
export function setOnThisPhone(on: boolean): void {
  const st = useTogether.getState();
  if (st.mode !== 'guest') return;
  st.patch({ onThisPhone: on });
  if (on) {
    missed = null;
    tapToListen();
    livePoke?.();
  } else {
    const p = usePlayerStore.getState();
    if (p.isPlaying) asRoom(() => p.togglePlay());
    audioEngine.setRate(p.rate || 1);
  }
}

/**
 * 1.14 — guest: start over in step with the host. The host's clock is read
 * afresh from the next answers, and this phone jumps straight to where the
 * host is, as if it had just joined. For a phone that sounds behind however
 * long it waits.
 */
export function resync(): void {
  const st = useTogether.getState();
  if (st.mode !== 'guest' || !st.code) return;
  // The host's playhead, kept from the last answers, carried into a fresh clock.
  const songId = clock.songId;
  const fresh = new HostClock();
  clock = fresh;
  clockCode = st.code;
  landing = null;
  lastCorrection = 0;
  trackStartedAt = 0;
  playAttempts = 0;
  missed = null;
  audioEngine.setRate(1);
  st.patch({ drift: null });
  if (st.onThisPhone) {
    // Nothing to measure from until the room answers: read it now. The
    // answer starts the host's song here if it is not playing yet, and puts
    // the playhead where the host is.
    if (!songId || usePlayerStore.getState().queue[usePlayerStore.getState().index]?.id !== st.hostSong?.id) tapToListen();
  }
  livePoke?.();
  toast('Syncing with the host…', { key: 'lt-resync' });
}

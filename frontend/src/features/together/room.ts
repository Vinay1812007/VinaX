/**
 * Listen Together — what a live room shows beyond the session itself (1.13):
 * chat lines that have not come back from the server yet, who is typing, the
 * reactions in the air and the room's energy.
 *
 * Its own small store, loaded with the room (the session store is on the
 * app's first-load path and stays tiny). The rules are plain functions so
 * they are unit-tested (room.test.ts).
 */
import { create } from 'zustand';
import type { RoomMessage } from '@/services/together';

/** A chat line this phone has shown before the server listed it. */
export interface LiveLineMessage {
  id: string;
  by: string;
  text: string;
  /** This device's clock (ms) when the line was sent or arrived. */
  at: number;
  mine: boolean;
  /** `failed`: neither the live line nor the server took it. */
  state: 'sending' | 'sent' | 'failed';
}

/**
 * 1.14 — unread chat. A line from someone else that arrives while no chat is
 * on screen (the room page, or the player's Together tab) counts, until a
 * chat opens. What the room already said before this phone joined does not:
 * the first list from the server is taken as read. Plain functions on module
 * state, reset with the room.
 */
let chatOpen = 0;
let primed = false;
const known = new Set<string>();

/** How a line is known: the id its sender gave it, or (older apps) when, who and what. */
export const lineKey = (m: { id?: string; at: string | number; by: string; text: string }): string => m.id ?? `${m.at}|${m.by}|${m.text}`;

/**
 * Lines seen (from the server's list, `fromServer`, or the live line).
 * Returns how many of them are new and someone else's while no chat is open.
 */
export function noteChat(lines: Array<{ key: string; mine: boolean }>, fromServer: boolean): number {
  let fresh = 0;
  const counting = primed || !fromServer;
  for (const l of lines) {
    if (known.has(l.key)) continue;
    known.add(l.key);
    if (counting && !l.mine && chatOpen === 0) fresh += 1;
  }
  if (fromServer) primed = true;
  if (known.size > 400) {
    // Only the newest matter: the room keeps 40 lines.
    const keep = [...known].slice(-200);
    known.clear();
    keep.forEach((k) => known.add(k));
  }
  return fresh;
}
/** A chat is on screen: everything is read while it stays. Returns the "closed" function. */
export function chatShown(): () => void {
  chatOpen += 1;
  return () => {
    chatOpen = Math.max(0, chatOpen - 1);
  };
}
export const chatIsOpen = (): boolean => chatOpen > 0;
export function resetUnread(): void {
  primed = false;
  known.clear();
}

export interface ChatRow {
  key: string;
  by: string;
  text: string;
  /** ms, or null when the time is not known. */
  at: number | null;
  mine: boolean;
  state: 'sending' | 'sent' | 'failed';
  /** The same sender as the row above, moments later: the name is not repeated. */
  joined: boolean;
}

/** Lines closer together than this (ms) from one sender read as one turn. */
const SAME_TURN_MS = 120_000;

/**
 * The chat as it is shown: the server's list, then the lines this phone has
 * that the server has not listed yet. A line is "mine" when this phone sent
 * it, which only its id says: two people in a room can have the same name.
 */
export function chatRows(server: RoomMessage[], extra: LiveLineMessage[], sentIds: ReadonlySet<string>): ChatRow[] {
  const listed = new Set<string>();
  const rows: Array<Omit<ChatRow, 'joined'>> = [];
  server.forEach((m, i) => {
    if (m.id) listed.add(m.id);
    const at = Date.parse(m.at);
    rows.push({
      key: m.id ?? `${m.at}-${i}`,
      by: m.by,
      text: m.text,
      at: Number.isFinite(at) ? at : null,
      mine: !!m.id && sentIds.has(m.id),
      state: 'sent',
    });
  });
  for (const x of extra) {
    if (listed.has(x.id)) continue;
    rows.push({ key: x.id, by: x.by, text: x.text, at: x.at, mine: x.mine, state: x.state });
  }
  return rows.map((r, i) => {
    const prev = rows[i - 1];
    const near = !!prev && (r.at === null || prev.at === null || Math.abs(r.at - prev.at) < SAME_TURN_MS);
    return { ...r, joined: !!prev && prev.by === r.by && prev.mine === r.mine && near };
  });
}

/** "Asha is typing…", for whoever is. */
export function typingText(names: string[]): string {
  if (!names.length) return '';
  if (names.length === 1) return `${names[0]} is typing`;
  if (names.length === 2) return `${names[0]} and ${names[1]} are typing`;
  return 'Several people are typing';
}

export interface Float {
  id: number;
  e: string;
  /** Where across the screen it rises (%), how big (px), how long (ms), and how far it leans (px). */
  left: number;
  size: number;
  ms: number;
  lean: number;
  delay: number;
  /** Who sent it, shown under someone else's reaction. */
  by: string | null;
}

/** Reactions that fill the meter: the room goes off when it is full. */
export const ENERGY_FULL = 10;
/** One step of energy fades this often (ms), once the room has gone quiet. */
const ENERGY_FADE_MS = 1500;
/** After the room goes off, how long before it can again (ms). */
const BURST_REST_MS = 15_000;
const BURST_PIECES = 42;
const BURST_SHOW_MS = 3600;
/** The most reactions in the air at once. */
const FLOAT_MAX = 90;

interface RoomExtras {
  /** True while the live line is up: the room is instant. */
  online: boolean;
  extra: LiveLineMessage[];
  /** Names typing right now. */
  typing: string[];
  floats: Float[];
  /** 0 … ENERGY_FULL. */
  energy: number;
  /** Counts up each time the room goes off; 0 while it never has. */
  burst: number;
  /** True for a few seconds after the room goes off. */
  bursting: boolean;
  patch(p: Partial<Pick<RoomExtras, 'online' | 'extra'>>): void;
  /** A line seen on the live line, or sent from here. */
  line(m: LiveLineMessage): void;
  /** Drop the lines the server now lists. */
  listed(ids: ReadonlySet<string>): void;
  mark(id: string, state: LiveLineMessage['state']): void;
  setTyping(name: string, on: boolean): void;
  /** One reaction: rises across the whole screen and feeds the room's energy. */
  float(emojis: string[], by?: string | null): void;
  reset(): void;
}

const EMPTY = { online: false, extra: [] as LiveLineMessage[], typing: [] as string[], floats: [] as Float[], energy: 0, burst: 0, bursting: false };

let seq = 0;
let fade = 0;
let lastBurst = 0;
let burstOff = 0;
const typers = new Map<string, number>();
/** How long a "typing" stays without another keystroke (ms). */
export const TYPING_MS = 4000;

const between = (a: number, b: number): number => a + Math.random() * (b - a);

function piece(e: string, by: string | null, big: boolean, delay = 0): Float {
  seq += 1;
  return { id: seq, e, left: between(4, 92), size: big ? between(44, 64) : between(22, 34), ms: Math.round(big ? between(3000, 3800) : between(2400, 3400)), lean: between(-48, 48), delay: Math.round(delay), by };
}

export const useRoom = create<RoomExtras>((set, get) => {
  const add = (batch: Float[]): void => {
    if (!batch.length) return;
    set((s) => ({ floats: [...s.floats, ...batch].slice(-FLOAT_MAX) }));
    const ids = new Set(batch.map((b) => b.id));
    const longest = Math.max(...batch.map((b) => b.ms + b.delay));
    window.setTimeout(() => set((s) => ({ floats: s.floats.filter((f) => !ids.has(f.id)) })), longest + 200);
  };
  const feed = (n: number, emojis: string[]): void => {
    const now = Date.now();
    const energy = Math.min(ENERGY_FULL, get().energy + n);
    if (energy >= ENERGY_FULL && now - lastBurst > BURST_REST_MS) {
      // The room goes off: everyone's emoji, everywhere, for a few seconds.
      lastBurst = now;
      const pool = emojis.length ? emojis : ['🎉'];
      add(Array.from({ length: BURST_PIECES }, (_, i) => piece(pool[i % pool.length], null, i % 3 === 0, between(0, 1400))));
      set((s) => ({ energy: 0, burst: s.burst + 1, bursting: true }));
      window.clearTimeout(burstOff);
      burstOff = window.setTimeout(() => set({ bursting: false }), BURST_SHOW_MS);
      window.clearInterval(fade);
      fade = 0;
      return;
    }
    set({ energy });
    // The energy fades only once the room goes quiet: each reaction starts
    // the clock again. (A clock that kept ticking from the first one let a
    // fade land in the middle of ten quick reactions, so a full room on a
    // slow phone or a slow line never went off.)
    window.clearInterval(fade);
    fade = window.setInterval(() => {
      const left = Math.max(0, get().energy - 1);
      set({ energy: left });
      if (left === 0) {
        window.clearInterval(fade);
        fade = 0;
      }
    }, ENERGY_FADE_MS);
  };
  /** The emojis the room has used lately, for the burst. */
  let recent: string[] = [];
  return {
    ...EMPTY,
    patch: (p) => set(p),
    line: (m) =>
      set((s) => (s.extra.some((x) => x.id === m.id) ? s : { extra: [...s.extra, m].slice(-40) })),
    listed: (ids) =>
      set((s) => (s.extra.some((x) => ids.has(x.id)) ? { extra: s.extra.filter((x) => !ids.has(x.id)) } : s)),
    mark: (id, state) => set((s) => ({ extra: s.extra.map((x) => (x.id === id ? { ...x, state } : x)) })),
    setTyping: (name, on) => {
      window.clearTimeout(typers.get(name));
      typers.delete(name);
      if (on) typers.set(name, window.setTimeout(() => get().setTyping(name, false), TYPING_MS));
      const names = [...typers.keys()];
      const now = get().typing;
      if (names.length !== now.length || names.some((n, i) => n !== now[i])) set({ typing: names });
    },
    float: (emojis, by = null) => {
      const list = emojis.slice(0, 6);
      if (!list.length) return;
      // Each reaction: one large emoji and a few small ones around it.
      add(list.flatMap((e) => [piece(e, by, true), piece(e, null, false, 120), piece(e, null, false, 260), piece(e, null, false, 420)]));
      recent = [...recent, ...list].slice(-12);
      feed(list.length, [...new Set(recent)]);
    },
    reset: () => {
      window.clearInterval(fade);
      fade = 0;
      window.clearTimeout(burstOff);
      typers.forEach((t) => window.clearTimeout(t));
      typers.clear();
      lastBurst = 0;
      recent = [];
      set(EMPTY);
    },
  };
});

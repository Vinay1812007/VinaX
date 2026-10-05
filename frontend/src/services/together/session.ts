/**
 * Listen Together — the live session, owned by the app instead of a page.
 *
 * 10.0: the session used to live in ListenTogetherPage's component state, so
 * the moment a host opened Search to pick the next song — or a guest opened
 * the lyrics — the page unmounted, the host stopped broadcasting and the guest
 * stopped following, with nothing on screen saying so. A reload lost the room
 * entirely. Now this small store holds the session for the whole app
 * (AppLayout mounts the sync engine whenever `mode` is not idle) and the code
 * survives a reload of the tab (sessionStorage: per tab, gone when it closes).
 *
 * Kept tiny on purpose: it is on the first-load path. The engine, the page and
 * the floating "Live" pill are lazy.
 */
import { create } from 'zustand';
import type { Song } from '@/types';
import type { RoomTrack } from './index';

export type TogetherMode = 'idle' | 'host' | 'guest';
export type TogetherStatus = 'connecting' | 'live' | 'reconnecting' | 'host-away';

export interface ReactionFloat {
  id: number;
  e: string;
  left: number;
}

interface TogetherState {
  mode: TogetherMode;
  code: string;
  status: TogetherStatus;
  hostName: string | null;
  /** Names — only the host receives them (privacy: guests see a count). */
  members: string[];
  listenerCount: number;
  queue: RoomTrack[];
  /** What the host is playing, as the guest last saw it. */
  hostSong: Song | null;
  /** Guest: seconds ahead (+) or behind (−) the host, when measured. */
  drift: number | null;
  /** Guest: the browser blocked audio until the listener taps once. */
  needsTap: boolean;
  floats: ReactionFloat[];
  begin(mode: Exclude<TogetherMode, 'idle'>, code: string): void;
  patch(p: Partial<Omit<TogetherState, 'begin' | 'patch' | 'reset' | 'float'>>): void;
  float(emojis: string[]): void;
  reset(): void;
}

const KEY = 'vinax.together.session.v1';

function readSaved(): { mode: TogetherMode; code: string } {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return { mode: 'idle', code: '' };
    const v = JSON.parse(raw) as { mode?: unknown; code?: unknown };
    if ((v.mode === 'host' || v.mode === 'guest') && typeof v.code === 'string' && /^[A-Z0-9]{4,8}$/.test(v.code)) {
      return { mode: v.mode, code: v.code };
    }
  } catch {
    /* storage blocked: sessions just don't survive a reload */
  }
  return { mode: 'idle', code: '' };
}

function save(mode: TogetherMode, code: string): void {
  try {
    if (mode === 'idle') sessionStorage.removeItem(KEY);
    else sessionStorage.setItem(KEY, JSON.stringify({ mode, code }));
  } catch {
    /* best effort */
  }
}

const EMPTY = {
  status: 'connecting' as TogetherStatus,
  hostName: null,
  members: [] as string[],
  listenerCount: 1,
  queue: [] as RoomTrack[],
  hostSong: null,
  drift: null,
  needsTap: false,
  floats: [] as ReactionFloat[],
};

let floatSeq = 0;

export const useTogether = create<TogetherState>((set) => ({
  ...readSaved(),
  ...EMPTY,
  begin: (mode, code) => {
    save(mode, code);
    set({ mode, code, ...EMPTY });
  },
  patch: (p) => set(p),
  float: (emojis) => {
    const batch = emojis.slice(0, 6).map((e) => ({ id: ++floatSeq, e, left: 10 + Math.random() * 78 }));
    if (!batch.length) return;
    set((s) => ({ floats: [...s.floats, ...batch].slice(-24) }));
    const ids = new Set(batch.map((b) => b.id));
    setTimeout(() => set((s) => ({ floats: s.floats.filter((f) => !ids.has(f.id)) })), 2600);
  },
  reset: () => {
    save('idle', '');
    set({ mode: 'idle', code: '', ...EMPTY });
  },
}));

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
 * the floating "Live" pill are lazy; so is everything a live room shows on
 * top (chat in flight, typing, reactions: features/together/room.ts).
 */
import { create } from 'zustand';
import type { Song } from '@/types';
import type { RoomMessage, RoomPerson, RoomTrack } from './index';

export type TogetherMode = 'idle' | 'host' | 'guest';
export type TogetherStatus = 'connecting' | 'live' | 'reconnecting' | 'host-away';

interface TogetherState {
  mode: TogetherMode;
  code: string;
  status: TogetherStatus;
  hostName: string | null;
  /** Names — only the host receives them (privacy: guests see a count). */
  members: string[];
  listenerCount: number;
  queue: RoomTrack[];
  /** What the host is playing, as the guest last saw it: the room's stub
   *  (id, title, artwork), not a song the player can take as it is. */
  hostSong: Song | null;
  /** Guest: the id of the host's song this device could not get, if any. */
  unplayable: string | null;
  /** Guest: seconds ahead (+) or behind (−) the host, when measured. */
  drift: number | null;
  /** Guest: the browser blocked audio until the listener taps once. */
  needsTap: boolean;
  /** 15.0 — who is here (names members chose), the chat, skip votes, and the songs this session has played. */
  names: string[];
  messages: RoomMessage[];
  skipVotes: number;
  played: Song[];
  /**
   * 1.14 — the jam. Guests may play, pause and skip (the host decides); who
   * is here by handle, this device's handle and the host's; and, for a guest,
   * whether the music plays on this phone or only on the host's speaker.
   */
  guestControl: boolean;
  people: RoomPerson[];
  me: string | null;
  hostH: string | null;
  onThisPhone: boolean;
  /** Guest: whether the host's music is playing (this phone may be quiet as the remote). */
  hostPlaying: boolean;
  /** 1.14 — chat lines from others that arrived while no chat was on screen (the pill and the Together tab show it). */
  unread: number;
  begin(mode: Exclude<TogetherMode, 'idle'>, code: string): void;
  patch(p: Partial<Omit<TogetherState, 'begin' | 'patch' | 'reset'>>): void;
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
  unplayable: null as string | null,
  drift: null,
  needsTap: false,
  names: [] as string[],
  messages: [] as RoomMessage[],
  skipVotes: 0,
  played: [] as Song[],
  guestControl: true,
  people: [] as RoomPerson[],
  me: null as string | null,
  hostH: null as string | null,
  onThisPhone: true,
  hostPlaying: false,
  unread: 0,
};

export const useTogether = create<TogetherState>((set) => ({
  ...readSaved(),
  ...EMPTY,
  begin: (mode, code) => {
    save(mode, code);
    set({ mode, code, ...EMPTY });
  },
  patch: (p) => set(p),
  reset: () => {
    save('idle', '');
    set({ mode: 'idle', code: '', ...EMPTY });
  },
}));

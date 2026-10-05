import { create } from 'zustand';

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface Toast {
  id: number;
  message: string;
  /** v5.17.0 — optional one-tap action (Undo, View, Open…). */
  action?: ToastAction;
  /** 10.1.0 — optional artwork thumbnail shown at the start of the snackbar. */
  image?: string;
}

export interface ToastOptions {
  action?: ToastAction;
  /** 10.1.0 — artwork for the snackbar (a song's cover, say). */
  image?: string;
  /** Milliseconds on screen; actions get longer by default. */
  duration?: number;
}

interface ToastState {
  toasts: Toast[];
  push(message: string, opts?: ToastOptions): void;
  dismiss(id: number): void;
  /** Hold every dismiss timer (pointer over / focus inside the toast stack). */
  pause(): void;
  /** Restart the held timers with whatever time each toast had left. */
  resume(): void;
}

let nextId = 1;

/** 10.1.0 — snackbars: at most two on screen; the oldest makes way. */
export const MAX_TOASTS = 2;
/** On screen this long unless the caller says otherwise… */
export const TOAST_MS = 4000;
/** …and a little longer when there is something to tap. */
export const TOAST_ACTION_MS = 5000;

/** A resumed toast always gets at least this long — it must not vanish the
 *  instant the pointer leaves. */
const MIN_RESUME_MS = 1000;

interface Timer {
  /** Pending timeout, or null while paused. */
  handle: number | null;
  remaining: number;
  startedAt: number;
}
const timers = new Map<number, Timer>();
let paused = false;

function start(id: number, timer: Timer, dismiss: (id: number) => void): void {
  timer.startedAt = Date.now();
  timer.handle = window.setTimeout(() => dismiss(id), timer.remaining);
}

export const useToastStore = create<ToastState>()((set, get) => ({
  toasts: [],
  push: (message, opts) => {
    const id = nextId++;
    // The same words twice (two code paths confirming one tap) show once:
    // the older copy makes way for the new one.
    const others = get().toasts.filter((t) => t.message !== message);
    const toasts = [...others.slice(-(MAX_TOASTS - 1)), { id, message, action: opts?.action, image: opts?.image }];
    // Toasts squeezed out by the cap take their timers with them.
    for (const [tid, t] of timers) {
      if (!toasts.some((x) => x.id === tid)) {
        if (t.handle !== null) window.clearTimeout(t.handle);
        timers.delete(tid);
      }
    }
    set({ toasts });
    const timer: Timer = { handle: null, remaining: opts?.duration ?? (opts?.action ? TOAST_ACTION_MS : TOAST_MS), startedAt: Date.now() };
    timers.set(id, timer);
    if (!paused) start(id, timer, get().dismiss);
  },
  dismiss: (id) => {
    const t = timers.get(id);
    if (t && t.handle !== null) window.clearTimeout(t.handle);
    timers.delete(id);
    set({ toasts: get().toasts.filter((x) => x.id !== id) });
    // Nothing left to hover: never strand the stack in a paused state.
    if (!timers.size) paused = false;
  },
  pause: () => {
    if (paused) return;
    paused = true;
    const now = Date.now();
    for (const t of timers.values()) {
      if (t.handle === null) continue;
      window.clearTimeout(t.handle);
      t.handle = null;
      t.remaining = Math.max(0, t.remaining - (now - t.startedAt));
    }
  },
  resume: () => {
    if (!paused) return;
    paused = false;
    for (const [id, t] of timers) {
      if (t.handle !== null) continue;
      t.remaining = Math.max(MIN_RESUME_MS, t.remaining);
      start(id, t, get().dismiss);
    }
  },
}));

/**
 * Show a snackbar. `toast('Saved')` is the whole API most callers need;
 * `opts` adds an artwork thumbnail, one action and a custom duration.
 */
export const toast = (message: string, opts?: ToastOptions): void => useToastStore.getState().push(message, opts);

// A "View" action needs the router, which code outside React (stores,
// services) cannot reach. The mounted <Toasts /> host registers it here.
let navigator: ((to: string) => void) | null = null;
export function setToastNavigator(fn: ((to: string) => void) | null): void {
  navigator = fn;
}
/** Go to an in-app path from a toast action (falls back to a page load). */
export function toastNavigate(to: string): void {
  if (navigator) navigator(to);
  else window.location.assign(to);
}

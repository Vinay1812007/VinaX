import { create } from 'zustand';

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface Toast {
  id: number;
  message: string;
  /** v5.17.0 — optional one-tap action (Undo, Open…). */
  action?: ToastAction;
}

export interface ToastOptions {
  action?: ToastAction;
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
    const toasts = [...get().toasts.slice(-2), { id, message, action: opts?.action }];
    // Toasts squeezed out by the three-deep cap take their timers with them.
    for (const [tid, t] of timers) {
      if (!toasts.some((x) => x.id === tid)) {
        if (t.handle !== null) window.clearTimeout(t.handle);
        timers.delete(tid);
      }
    }
    set({ toasts });
    const timer: Timer = { handle: null, remaining: opts?.duration ?? (opts?.action ? 5000 : 2400), startedAt: Date.now() };
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

export const toast = (message: string, opts?: ToastOptions): void => useToastStore.getState().push(message, opts);

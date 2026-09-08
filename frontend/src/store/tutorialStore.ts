import { create } from 'zustand';
import { STORAGE_PREFIX } from '@/constants/storage-keys';

/**
 * v5.20.0 — live tutorials. A guided walkthrough that runs INSIDE the real
 * app: it navigates, spotlights the real controls, and can start music while
 * it explains. This store is tiny and first-load; the runner and the tutorial
 * definitions are lazy chunks loaded only when a tutorial starts.
 */
const DONE_KEY = `${STORAGE_PREFIX}.tutorials.v1`;

function loadDone(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(DONE_KEY) ?? '[]') as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

interface TutorialState {
  activeId: string | null;
  step: number;
  done: string[];
  start(id: string): void;
  stop(): void;
  go(step: number): void;
  finish(): void;
}

export const useTutorialStore = create<TutorialState>((set, get) => ({
  activeId: null,
  step: 0,
  done: loadDone(),
  start: (id) => set({ activeId: id, step: 0 }),
  stop: () => set({ activeId: null, step: 0 }),
  go: (step) => set({ step: Math.max(0, step) }),
  finish: () => {
    const id = get().activeId;
    const done = id && !get().done.includes(id) ? [...get().done, id] : get().done;
    try {
      localStorage.setItem(DONE_KEY, JSON.stringify(done));
    } catch {
      /* storage blocked — progress just isn't remembered */
    }
    set({ activeId: null, step: 0, done });
  },
}));

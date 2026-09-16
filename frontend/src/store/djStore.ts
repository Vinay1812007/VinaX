import { create } from 'zustand';

/**
 * v6.2.0 — what the AI DJ said about the current stretch of the queue.
 * Session-only: the intro line for the last set it built and one spoken
 * segue per song id, read by the DJ voice as each song starts and shown
 * in Now Playing. Never persisted.
 */
interface DjState {
  intro: string | null;
  introAt: number | null;
  segues: Record<string, string>;
  setSet(intro: string, segues: Array<[string, string]>): void;
  clear(): void;
}

export const useDjStore = create<DjState>()((set, get) => ({
  intro: null,
  introAt: null,
  segues: {},
  setSet: (intro, segues) => {
    const next = { ...get().segues, ...Object.fromEntries(segues.filter(([, line]) => !!line)) };
    const keys = Object.keys(next);
    if (keys.length > 200) for (const k of keys.slice(0, keys.length - 200)) delete next[k];
    set({ intro: intro || get().intro, introAt: intro ? Date.now() : get().introAt, segues: next });
  },
  clear: () => set({ intro: null, introAt: null, segues: {} }),
}));

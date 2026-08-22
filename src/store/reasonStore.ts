import { create } from 'zustand';

interface ReasonState {
  /** Short "why this song" notes from the AI DJ, keyed by song id (session-only). */
  reasons: Record<string, string>;
  setReasons(entries: Array<[string, string]>): void;
}

export const useReasonStore = create<ReasonState>()((set, get) => ({
  reasons: {},
  setReasons: (entries) => {
    if (!entries.length) return;
    const reasons = { ...get().reasons, ...Object.fromEntries(entries) };
    const keys = Object.keys(reasons);
    if (keys.length > 300) {
      for (const k of keys.slice(0, keys.length - 300)) delete reasons[k];
    }
    set({ reasons });
  },
}));

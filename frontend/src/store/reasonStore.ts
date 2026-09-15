import { create } from 'zustand';

interface ReasonState {
  /** Session-only explanations from catalog recommendations and playlists. */
  reasons: Record<string, string>;
  setReasons(entries: Array<[string, string]>): void;
  fillReasons(entries: Array<[string, string]>): void;
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
  // Fill missing explanations while preserving existing entries.
  fillReasons: (entries) => {
    const cur = get().reasons;
    const fresh = entries.filter(([id, line]) => !!line && !(id in cur));
    if (fresh.length) get().setReasons(fresh);
  },
}));

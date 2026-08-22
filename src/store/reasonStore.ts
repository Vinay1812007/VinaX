import { create } from 'zustand';

interface ReasonState {
  /** Short "why this song" notes, keyed by song id (session-only). AI DJ lines
   *  land via setReasons; the local engine's explainable-scoring lines land via
   *  fillReasons (Package C4) and never overwrite a richer AI line. */
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
  // C4 — only-if-absent merge: the AI DJ's specific one-liners outrank the
  // local scorer's generic ones, so a fill never clobbers an existing entry.
  fillReasons: (entries) => {
    const cur = get().reasons;
    const fresh = entries.filter(([id, line]) => !!line && !(id in cur));
    if (fresh.length) get().setReasons(fresh);
  },
}));

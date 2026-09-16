import { create } from 'zustand';
import type { Song } from '@/types';
import type { ReasonComponent } from '@/services/recommendation/types';

/**
 * v6.4.0 — recommendation debug feed. Filled by the engine ONLY when the
 * debug view is enabled (`?debug=recs`, or `vinax.debug.recs` = '1' in
 * localStorage, or a dev build); production listeners never pay for it.
 */
export interface DebugRow {
  position: number;
  song: Song;
  finalScore: number;
  source: string;
  components: ReasonComponent[];
  /** Who chose the final order. */
  picker: 'local' | 'ai';
  /** The DJ's confidence when it picked. */
  confidence?: number;
}

export interface DebugBatch {
  at: number;
  rows: DebugRow[];
}

interface RecsDebugState {
  batches: DebugBatch[];
  publish(rows: DebugRow[]): void;
  clear(): void;
}

export function recsDebugEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    if (new URLSearchParams(window.location.search).get('debug') === 'recs') return true;
    if (window.localStorage.getItem('vinax.debug.recs') === '1') return true;
  } catch {
    /* storage blocked */
  }
  return import.meta.env.DEV;
}

export const useRecsDebugStore = create<RecsDebugState>()((set, get) => ({
  batches: [],
  publish: (rows) => set({ batches: [{ at: Date.now(), rows }, ...get().batches].slice(0, 12) }),
  clear: () => set({ batches: [] }),
}));

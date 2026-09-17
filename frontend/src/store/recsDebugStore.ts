import { create } from 'zustand';
import type { Song } from '@/types';
import type { ReasonComponent, RejectedCandidate } from '@/services/recommendation/types';

/**
 * v6.4.0 — recommendation debug feed. Filled by the engine ONLY when the
 * debug view is enabled (`?debug=recs`, or `vinax.debug.recs` = '1' in
 * localStorage, or a dev build); production listeners never pay for it.
 */
export interface DebugRow {
  position: number;
  /** v7.0.0 — where the ranker had it before sequencing (absent for a DJ discovery). */
  rank?: number;
  song: Song;
  finalScore: number;
  source: string;
  components: ReasonComponent[];
  /** Who chose the final order. */
  picker: 'local' | 'ai';
  /** The DJ's confidence when it picked. */
  confidence?: number;
}

/** v7.0.0 — how the pipeline ran: the knobs that shaped it and how many songs survived each stage. */
export interface DebugTrace {
  mode: 'familiar' | 'balanced' | 'discover';
  shape: string;
  lock: string | null;
  languagePolicy: 'lock' | 'prefer';
  discoveryShare: number;
  intent: { skipStreak: number; completionStreak: number; discoveryAppetite: number; energySteer: number } | null;
  stages: { candidates: number; admitted: number; ranked: number; sequenced: number; validated: number };
  relaxed: string[];
  repairs: number;
}

/** v7.0.0 — a song that scored but was not chosen for this stretch. */
export interface DebugPassedOver {
  song: Song;
  rank: number;
  finalScore: number;
  source: string;
  components: ReasonComponent[];
}

export interface DebugBatch {
  at: number;
  rows: DebugRow[];
  trace?: DebugTrace;
  rejected: RejectedCandidate[];
  passedOver: DebugPassedOver[];
}

interface RecsDebugState {
  batches: DebugBatch[];
  publish(rows: DebugRow[], extra?: { trace?: DebugTrace; rejected?: RejectedCandidate[]; passedOver?: DebugPassedOver[] }): void;
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
  publish: (rows, extra = {}) => set({ batches: [{ at: Date.now(), rows, trace: extra.trace, rejected: (extra.rejected ?? []).slice(0, 80), passedOver: extra.passedOver ?? [] }, ...get().batches].slice(0, 12) }),
  clear: () => set({ batches: [] }),
}));

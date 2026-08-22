import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { KEYS } from '@/constants/storage-keys';

/**
 * Per-song lyric sync offset (seconds). Positive = lyrics shown LATER (use when
 * lyrics run ahead of the music); negative = earlier. LRCLIB timings are often
 * a touch off for regional/film songs, so users can nudge the alignment and it
 * persists per track.
 */
interface LyricsOffsetState {
  offsets: Record<string, number>;
  nudge(id: string, delta: number): void;
  reset(id: string): void;
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const clamp = (n: number) => Math.max(-10, Math.min(10, n));

export const useLyricsOffsetStore = create<LyricsOffsetState>()(
  persist(
    (set, get) => ({
      offsets: {},
      nudge: (id, delta) => {
        const next = clamp(round1((get().offsets[id] ?? 0) + delta));
        const offsets = { ...get().offsets };
        if (next === 0) delete offsets[id];
        else offsets[id] = next;
        set({ offsets });
      },
      reset: (id) => {
        const offsets = { ...get().offsets };
        delete offsets[id];
        set({ offsets });
      },
    }),
    { name: KEYS.lyricsOffset, storage: createJSONStorage(() => window.localStorage) },
  ),
);

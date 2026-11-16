/**
 * Disco lights — the listener's adjustments, kept on this device only
 * (KEYS.disco; not in backups or sync: a light show suits a room, not an
 * account).
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { KEYS } from '@/constants/storage-keys';

export type DiscoStyle = 'party' | 'spotlights' | 'lasers' | 'wash';
export type DiscoPalette = 'artwork' | 'rainbow' | 'neon' | 'warm' | 'cool';

export const DISCO_STYLES: Array<{ id: DiscoStyle; label: string; hint: string }> = [
  { id: 'party', label: 'Party', hint: 'Sweeping beams and a mirror ball' },
  { id: 'spotlights', label: 'Spotlights', hint: 'Round spots that jump on the beat' },
  { id: 'lasers', label: 'Lasers', hint: 'Thin beams fanning from the floor' },
  { id: 'wash', label: 'Wash', hint: 'The whole screen changes colour, gently' },
];

export const DISCO_PALETTES: Array<{ id: DiscoPalette; label: string }> = [
  { id: 'artwork', label: 'Song colours' },
  { id: 'rainbow', label: 'Rainbow' },
  { id: 'neon', label: 'Neon' },
  { id: 'warm', label: 'Warm' },
  { id: 'cool', label: 'Cool' },
];

export interface DiscoSettings {
  style: DiscoStyle;
  palette: DiscoPalette;
  /** Overall light, 0.2-1. */
  brightness: number;
  /** Beat sensitivity, 0 (only the hardest hits) to 1 (nearly every bump). */
  sensitivity: number;
  /** How fast the lights move, 0.25-2 (1 = normal). */
  speed: number;
  /** A white flash on strong beats (at most three a second). Off by default. */
  flash: boolean;
}

export const DISCO_DEFAULTS: DiscoSettings = {
  style: 'party',
  palette: 'artwork',
  brightness: 0.8,
  sensitivity: 0.5,
  speed: 1,
  flash: false,
};

interface DiscoState extends DiscoSettings {
  set: (patch: Partial<DiscoSettings>) => void;
  resetAll: () => void;
}

const clamp = (v: unknown, lo: number, hi: number, dflt: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : dflt;

/** Persisted state of any shape → valid settings (unknown values fall back to the defaults). */
export function sanitizeDisco(raw: unknown): DiscoSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    style: DISCO_STYLES.some((s) => s.id === r.style) ? (r.style as DiscoStyle) : DISCO_DEFAULTS.style,
    palette: DISCO_PALETTES.some((p) => p.id === r.palette) ? (r.palette as DiscoPalette) : DISCO_DEFAULTS.palette,
    brightness: clamp(r.brightness, 0.2, 1, DISCO_DEFAULTS.brightness),
    sensitivity: clamp(r.sensitivity, 0, 1, DISCO_DEFAULTS.sensitivity),
    speed: clamp(r.speed, 0.25, 2, DISCO_DEFAULTS.speed),
    flash: typeof r.flash === 'boolean' ? r.flash : DISCO_DEFAULTS.flash,
  };
}

export const useDiscoStore = create<DiscoState>()(
  persist(
    (set) => ({
      ...DISCO_DEFAULTS,
      set: (patch) => set((s) => sanitizeDisco({ ...s, ...patch })),
      resetAll: () => set({ ...DISCO_DEFAULTS }),
    }),
    {
      name: KEYS.disco,
      version: 1,
      partialize: (s) => sanitizeDisco(s),
      merge: (persisted, current) => ({ ...current, ...sanitizeDisco(persisted) }),
    },
  ),
);

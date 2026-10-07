import { useMemo } from 'react';
import { create } from 'zustand';
import { FESTIVALS, resolveFestival, resolveFestivalTheme, type Festival } from '@/constants/festivals';
import { useSettingsStore } from '@/store/settingsStore';
import { useFestivalOverride } from '@/features/home/useAppConfig';

/**
 * "Preview a festival" (Settings → Appearance). Session-only on purpose: it is
 * held in memory, never persisted, and a reload returns to the real calendar.
 */
export const useFestivalPreview = create<{ id: string | null; setId: (id: string | null) => void }>((set) => ({
  id: null,
  setId: (id) => set({ id }),
}));

export interface FestivalNow {
  /** The festival whose greeting applies today (real window, owner override, or preview). */
  festival: Festival | null;
  /** The festival whose skin applies (also the day before its window). */
  theme: Festival | null;
  preview: boolean;
}

/** One answer for the splash, the backdrop and the Home strip. */
export function useFestivalNow(): FestivalNow {
  const { data: serverOverride } = useFestivalOverride();
  const skinsOn = useSettingsStore((s) => s.festivalSkins);
  const previewId = useFestivalPreview((s) => s.id);
  return useMemo(() => {
    const previewed = previewId ? FESTIVALS.find((f) => f.id === previewId) ?? null : null;
    if (previewed) return { festival: previewed, theme: previewed, preview: true };
    const override = skinsOn ? serverOverride : { mode: 'off' as const };
    return { festival: resolveFestival(override), theme: resolveFestivalTheme(override), preview: false };
  }, [previewId, skinsOn, serverOverride]);
}

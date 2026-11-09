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
  /** 1.12 — the listener pinned this festival's look in Settings (festivalPin). */
  pinned?: boolean;
  /** Console rebuild — the owner's own accent colour for a forced festival ("#rrggbb"), when set. */
  color?: string;
}

/** One answer for the splash, the backdrop and the Home strip. */
export function useFestivalNow(): FestivalNow {
  const { data: serverOverride } = useFestivalOverride();
  const skinsOn = useSettingsStore((s) => s.festivalSkins);
  const pinId = useSettingsStore((s) => s.festivalPin);
  const previewId = useFestivalPreview((s) => s.id);
  return useMemo(() => {
    const previewed = previewId ? FESTIVALS.find((f) => f.id === previewId) ?? null : null;
    if (previewed) return { festival: previewed, theme: previewed, preview: true };
    // 1.12 — a pinned look stays on until the listener chooses Automatic again.
    const pinned = skinsOn && pinId ? FESTIVALS.find((f) => f.id === pinId) ?? null : null;
    if (pinned) return { festival: pinned, theme: pinned, preview: false, pinned: true };
    const override = skinsOn ? serverOverride : { mode: 'off' as const };
    const color = skinsOn && serverOverride?.mode === 'force' && typeof serverOverride.color === 'string' && /^#[0-9a-f]{6}$/i.test(serverOverride.color) ? serverOverride.color : undefined;
    return { festival: resolveFestival(override), theme: resolveFestivalTheme(override), preview: false, ...(color ? { color } : {}) };
  }, [previewId, pinId, skinsOn, serverOverride]);
}

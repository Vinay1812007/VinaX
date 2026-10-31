/**
 * VinaX AI — the artifacts panel: which artifact (and which version) is
 * open, Preview or Code, and how wide the panel is on a wide screen (40–60%
 * of the chat, kept on the device).
 */
import { create } from 'zustand';

const WIDTH_KEY = 'vinax.vxai.panel.v1';
const readWidth = (): number => {
  try {
    const n = Number(localStorage.getItem(WIDTH_KEY));
    return n >= 40 && n <= 60 ? n : 48;
  } catch {
    return 48;
  }
};

interface PanelState {
  /** The open artifact, or null. `version` is an index into its versions; null follows the newest. */
  open: { id: string; version: number | null } | null;
  tab: 'preview' | 'code';
  /** Opened by a reply as it was written: switch to Preview when it is done. */
  following: boolean;
  width: number;
  show(id: string, version: number | null, opts?: { tab?: 'preview' | 'code'; following?: boolean }): void;
  setTab(tab: 'preview' | 'code'): void;
  setVersion(version: number): void;
  setWidth(width: number): void;
  close(): void;
}

export const usePanel = create<PanelState>()((set) => ({
  open: null,
  tab: 'preview',
  following: false,
  width: readWidth(),
  show: (id, version, opts = {}) => set({ open: { id, version }, tab: opts.tab ?? 'preview', following: !!opts.following }),
  setTab: (tab) => set({ tab, following: false }),
  setVersion: (version) => set((s) => (s.open ? { open: { ...s.open, version }, following: false } : s)),
  setWidth: (width) => {
    const w = Math.min(60, Math.max(40, Math.round(width)));
    set({ width: w });
    try { localStorage.setItem(WIDTH_KEY, String(w)); } catch { /* this session only */ }
  },
  close: () => set({ open: null, following: false }),
}));

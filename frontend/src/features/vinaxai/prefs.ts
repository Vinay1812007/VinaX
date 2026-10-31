/**
 * VinaX AI — this device's chat preferences: the model picked in the
 * composer ('auto' or a registry id), Extended thinking, and whether the
 * desktop sidebar is collapsed. Kept in localStorage under a key the boot
 * migration does not sweep (it clears the old `vinax.ai…` keys).
 */
import { create } from 'zustand';

export const PREFS_KEY = 'vinax.vxai.prefs.v1';

export interface ChatPrefs {
  model: string;
  extendedThinking: boolean;
  sidebarCollapsed: boolean;
}

const DEFAULTS: ChatPrefs = { model: 'auto', extendedThinking: false, sidebarCollapsed: false };

function load(): ChatPrefs {
  try {
    const raw = JSON.parse(localStorage.getItem(PREFS_KEY) ?? 'null') as Partial<ChatPrefs> | null;
    if (!raw || typeof raw !== 'object') return DEFAULTS;
    return {
      model: typeof raw.model === 'string' && raw.model.length < 200 ? raw.model : 'auto',
      extendedThinking: raw.extendedThinking === true,
      sidebarCollapsed: raw.sidebarCollapsed === true,
    };
  } catch {
    return DEFAULTS;
  }
}

interface PrefsStore extends ChatPrefs {
  set(patch: Partial<ChatPrefs>): void;
}

export const usePrefs = create<PrefsStore>()((set, get) => ({
  ...load(),
  set: (patch) => {
    set(patch);
    const { model, extendedThinking, sidebarCollapsed } = get();
    try { localStorage.setItem(PREFS_KEY, JSON.stringify({ model, extendedThinking, sidebarCollapsed })); } catch { /* storage blocked: this session only */ }
  },
}));

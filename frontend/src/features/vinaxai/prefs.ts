/**
 * VinaX AI — this device's chat preferences: the model picked in the
 * composer ('auto' or a registry id), Extended thinking, whether the
 * desktop sidebar is collapsed, the voices for Read aloud and Live, the
 * Live model, and the microphone.
 * Kept in localStorage under a key the boot migration does not sweep (it
 * clears the old `vinax.ai…` keys).
 */
import { create } from 'zustand';

export const PREFS_KEY = 'vinax.vxai.prefs.v1';

export interface ChatPrefs {
  model: string;
  /** Web search: 'auto' searches when a message is about something current. */
  webSearch: 'auto' | 'on' | 'off';
  extendedThinking: boolean;
  sidebarCollapsed: boolean;
  /** Read aloud voice (Groq Orpheus id); the server checks it against its list. */
  voice: string;
  /** Live voice (a Gemini voice), also used when Gemini reads aloud. */
  liveVoice: string;
  /** Live model: 'auto' or a Live model id from GET /api/ai/models (the server checks it). */
  liveModel: string;
  /** Microphone deviceId picked in Settings; '' = automatic (a real mic, never a silent virtual one). */
  micId: string;
}

const DEFAULTS: ChatPrefs = { model: 'auto', webSearch: 'auto', extendedThinking: false, sidebarCollapsed: false, voice: 'troy', liveVoice: 'Kore', liveModel: 'auto', micId: '' };
const VOICE_ID = /^[A-Za-z]{2,20}$/;
const LIVE_MODEL_ID = /^[a-z0-9][a-z0-9.-]{1,80}$/;

function load(): ChatPrefs {
  try {
    const raw = JSON.parse(localStorage.getItem(PREFS_KEY) ?? 'null') as Partial<ChatPrefs> | null;
    if (!raw || typeof raw !== 'object') return DEFAULTS;
    return {
      model: typeof raw.model === 'string' && raw.model.length < 200 ? raw.model : 'auto',
      webSearch: raw.webSearch === 'on' || raw.webSearch === 'off' ? raw.webSearch : 'auto',
      extendedThinking: raw.extendedThinking === true,
      sidebarCollapsed: raw.sidebarCollapsed === true,
      voice: typeof raw.voice === 'string' && VOICE_ID.test(raw.voice) ? raw.voice : DEFAULTS.voice,
      liveVoice: typeof raw.liveVoice === 'string' && VOICE_ID.test(raw.liveVoice) ? raw.liveVoice : DEFAULTS.liveVoice,
      liveModel: typeof raw.liveModel === 'string' && (raw.liveModel === 'auto' || LIVE_MODEL_ID.test(raw.liveModel)) ? raw.liveModel : 'auto',
      micId: typeof raw.micId === 'string' && raw.micId.length <= 200 ? raw.micId : '',
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
    const { model, webSearch, extendedThinking, sidebarCollapsed, voice, liveVoice, liveModel, micId } = get();
    try { localStorage.setItem(PREFS_KEY, JSON.stringify({ model, webSearch, extendedThinking, sidebarCollapsed, voice, liveVoice, liveModel, micId })); } catch { /* storage blocked: this session only */ }
  },
}));

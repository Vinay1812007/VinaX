/**
 * VinaX AI — this device's chat preferences: the model picked in the
 * composer ('auto' or a registry id), Extended thinking, whether the
 * desktop sidebar is collapsed, the voices for Read aloud and Live, the
 * Live model, web search in Live voice, the microphone, and the Personalisation
 * and Features choices in VinaX AI's settings (sent with each message, never
 * stored on the server).
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
  /** Artifacts: whole files, pages, charts and diagrams in their own panel. */
  artifacts: boolean;
  /** Show html, svg, diagram and React artifacts as live previews inside the reply. */
  inlinePreviews: boolean;
  /** Personalisation: what VinaX AI calls the user ('' = the account's first name). */
  personalName: string;
  personalAbout: string;
  personalInstructions: string;
  style: ReplyStyle;
  /** Live voice may search the web (when the owner allows it). */
  liveSearch: boolean;
  /** Android app: Live voice plays on the loudspeaker (true) or the earpiece, like a phone call. */
  liveSpeaker: boolean;
}

export type ReplyStyle = 'normal' | 'concise' | 'explanatory' | 'formal' | 'learning';
export const REPLY_STYLES: readonly ReplyStyle[] = ['normal', 'concise', 'explanatory', 'formal', 'learning'];
export const PERSONAL_MAX = Object.freeze({ name: 40, about: 1_500, instructions: 1_500 });

const DEFAULTS: ChatPrefs = {
  model: 'auto', webSearch: 'auto', extendedThinking: false, sidebarCollapsed: false, voice: 'troy', liveVoice: 'Kore', liveModel: 'auto', micId: '',
  artifacts: true, inlinePreviews: true, personalName: '', personalAbout: '', personalInstructions: '', style: 'normal', liveSearch: true, liveSpeaker: true,
};
const text = (v: unknown, max: number): string => (typeof v === 'string' ? v.slice(0, max) : '');
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
      artifacts: raw.artifacts !== false,
      inlinePreviews: raw.inlinePreviews !== false,
      personalName: text(raw.personalName, PERSONAL_MAX.name),
      personalAbout: text(raw.personalAbout, PERSONAL_MAX.about),
      personalInstructions: text(raw.personalInstructions, PERSONAL_MAX.instructions),
      style: REPLY_STYLES.includes(raw.style as ReplyStyle) ? (raw.style as ReplyStyle) : 'normal',
      liveSearch: raw.liveSearch !== false,
      liveSpeaker: raw.liveSpeaker !== false,
    };
  } catch {
    return DEFAULTS;
  }
}

interface PrefsStore extends ChatPrefs {
  set(patch: Partial<ChatPrefs>): void;
}

/** The Personalisation block a chat request carries, or undefined when nothing is set. */
export function personalOf(p: Pick<ChatPrefs, 'personalName' | 'personalAbout' | 'personalInstructions' | 'style'>): { name?: string; about?: string; instructions?: string; style?: ReplyStyle } | undefined {
  const name = p.personalName.trim();
  const about = p.personalAbout.trim();
  const instructions = p.personalInstructions.trim();
  if (!name && !about && !instructions && p.style === 'normal') return undefined;
  return { ...(name ? { name } : {}), ...(about ? { about } : {}), ...(instructions ? { instructions } : {}), ...(p.style !== 'normal' ? { style: p.style } : {}) };
}

export const usePrefs = create<PrefsStore>()((set, get) => ({
  ...load(),
  set: (patch) => {
    set(patch);
    const all = get();
    const saved = Object.fromEntries((Object.keys(DEFAULTS) as Array<keyof ChatPrefs>).map((k) => [k, all[k]]));
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(saved)); } catch { /* storage blocked: this session only */ }
  },
}));

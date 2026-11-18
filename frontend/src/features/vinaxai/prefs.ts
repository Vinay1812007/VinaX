/**
 * VinaX AI — this device's chat preferences: the model picked in the
 * composer ('auto' or a registry id), the Thinking choice, whether the
 * desktop sidebar is collapsed, the voices for Read aloud and Live, the
 * Live model, language and captions, web search in Live voice, the microphone, the Personalisation
 * and Features choices in VinaX AI's settings (sent with each message, never
 * stored on the server), the reply language, the chat font and text size,
 * and the finished-reply notification.
 * Kept in localStorage under a key the boot migration does not sweep (it
 * clears the old `vinax.ai…` keys).
 */
import { create } from 'zustand';
import { deviceLanguage } from './live/liveOptions';
import { THINKING_CHOICES, type ThinkingChoice } from './types';

export const PREFS_KEY = 'vinax.vxai.prefs.v1';

export interface ChatPrefs {
  model: string;
  /** Web search: 'auto' searches when a message is about something current. */
  webSearch: 'auto' | 'on' | 'off';
  /** Thinking: Auto (judged per message), or a fixed level; also the default for new chats. */
  thinking: ThinkingChoice;
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
  /** The language Live voice replies in: a code, or 'auto' (follows the user, without hopping between languages). */
  liveLanguage: string;
  /** Live voice shows what each side says. */
  liveCaptions: boolean;
  /** The language every reply is written in ('auto' = the language the listener writes in). */
  replyLanguage: string;
  /** The chat's reading face: VinaX AI's own, the device's, or a serif. */
  font: ChatFont;
  /** Larger text in replies and the composer. */
  largeText: boolean;
  /** A system notification when a reply finishes while the tab is in the background. */
  notifyDone: boolean;
}

export type ChatFont = 'default' | 'system' | 'serif';
export const CHAT_FONTS: readonly ChatFont[] = ['default', 'system', 'serif'];

export type ReplyStyle = 'normal' | 'concise' | 'explanatory' | 'formal' | 'learning';
export const REPLY_STYLES: readonly ReplyStyle[] = ['normal', 'concise', 'explanatory', 'formal', 'learning'];
export const PERSONAL_MAX = Object.freeze({ name: 40, about: 1_500, instructions: 1_500 });

const DEFAULTS: ChatPrefs = {
  liveLanguage: deviceLanguage(), liveCaptions: true, replyLanguage: 'auto', font: 'default', largeText: false, notifyDone: false,
  model: 'auto', webSearch: 'auto', thinking: 'auto', sidebarCollapsed: false, voice: 'troy', liveVoice: 'Kore', liveModel: 'auto', micId: '',
  artifacts: true, inlinePreviews: true, personalName: '', personalAbout: '', personalInstructions: '', style: 'normal', liveSearch: true, liveSpeaker: true,
};
const text = (v: unknown, max: number): string => (typeof v === 'string' ? v.slice(0, max) : '');
const VOICE_ID = /^[A-Za-z]{2,20}$/;
const LIVE_MODEL_ID = /^[a-z0-9][a-z0-9.-]{1,80}$/;
const LANGUAGE = /^(?:auto|[a-z]{2,3})$/;

function load(): ChatPrefs {
  try {
    const raw = JSON.parse(localStorage.getItem(PREFS_KEY) ?? 'null') as Partial<ChatPrefs> | null;
    if (!raw || typeof raw !== 'object') return DEFAULTS;
    return {
      model: typeof raw.model === 'string' && raw.model.length < 200 ? raw.model : 'auto',
      webSearch: raw.webSearch === 'on' || raw.webSearch === 'off' ? raw.webSearch : 'auto',
      // The older on/off Extended thinking switch becomes the Extended level.
      thinking: THINKING_CHOICES.includes(raw.thinking as ThinkingChoice) ? (raw.thinking as ThinkingChoice) : (raw as { extendedThinking?: unknown }).extendedThinking === true ? 'extended' : 'auto',
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
      liveLanguage: typeof raw.liveLanguage === 'string' && LANGUAGE.test(raw.liveLanguage) ? raw.liveLanguage : DEFAULTS.liveLanguage,
      liveCaptions: raw.liveCaptions !== false,
      replyLanguage: typeof raw.replyLanguage === 'string' && LANGUAGE.test(raw.replyLanguage) ? raw.replyLanguage : 'auto',
      font: CHAT_FONTS.includes(raw.font as ChatFont) ? (raw.font as ChatFont) : 'default',
      largeText: raw.largeText === true,
      notifyDone: raw.notifyDone === true,
    };
  } catch {
    return DEFAULTS;
  }
}

interface PrefsStore extends ChatPrefs {
  set(patch: Partial<ChatPrefs>): void;
}

/** The Personalisation block a chat request carries, or undefined when nothing is set. */
export function personalOf(p: Pick<ChatPrefs, 'personalName' | 'personalAbout' | 'personalInstructions' | 'style' | 'replyLanguage'>): { name?: string; about?: string; instructions?: string; style?: ReplyStyle; language?: string } | undefined {
  const name = p.personalName.trim();
  const about = p.personalAbout.trim();
  const instructions = p.personalInstructions.trim();
  const language = p.replyLanguage !== 'auto' ? p.replyLanguage : '';
  if (!name && !about && !instructions && p.style === 'normal' && !language) return undefined;
  return { ...(name ? { name } : {}), ...(about ? { about } : {}), ...(instructions ? { instructions } : {}), ...(p.style !== 'normal' ? { style: p.style } : {}), ...(language ? { language } : {}) };
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

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { isNativePlatform } from '@/services/native';
import { buildTasteSnapshot } from '@/services/ai/taste';
import { extractRecommendedFromThread } from '@/services/ai/threadMemory';
import { searchSongs } from '@/services/api';
import { usePlayerStore } from '@/store/playerStore';
import { ChatPlayerCard } from '@/components/ChatPlayerCard';
import { WaveformIcon } from '@/components/Icons';
import {
  LiveVoiceEngine,
  localRecognitionState,
  prepareLocalRecognition,
  type LiveVoiceState,
} from '@/features/voice/liveVoiceEngine';
import { createSttSession, probeSttSupport, sttSupported, type SttSession } from '@/features/voice/stt';
import { pickSynthVoice } from '@/features/voice/pickSynthVoice';
import { applyThemeClasses, resolveTheme } from '@/utils/theme';
import { LiveVoiceOverlay } from '@/features/voice/LiveVoiceOverlay';
import { SparkleIcon, GlobeIcon, PlusIcon, XIcon, SearchIcon, DownloadIcon, SettingsIcon, ChevronDownIcon } from '@/components/Icons';
import { cn } from '@/utils/cn';
import { RichContent } from '@/components/ai/RichContent';
import { usePageMeta } from '@/hooks/usePageMeta';
import { useSettingsStore } from '@/store/settingsStore';
import { useCurrentSong } from '@/store/playerStore';
import { getSong } from '@/services/api';
import { generatePlaylist } from '@/services/ai/playlist';
import { matchSlash, parseSlash, type SlashCommand } from '@/features/ai/slashCommands';
import { hideFollowupLine, splitFollowups } from '@/features/ai/followups';
import { onSpeakingChange, readAloud, readAloudSupported, setReadAloudVoice } from '@/features/ai/readAloud';
import { detectSongLinks, prefRuleMessage, songContextBlock } from '@/features/ai/replyPrefs';
import {
  ArrowUpRightIcon,
  BranchIcon,
  ContinueIcon,
  CopyIcon,
  ExpandIcon,
  FollowupChips,
  MoreMenu,
  PencilIcon,
  PinIcon,
  RefreshIcon,
  ReplyPrefsBar,
  SavedPromptsSheet,
  ShortenIcon,
  SimplifyIcon,
  SlashMenu,
  SpeakerIcon,
  StarIcon,
  ThumbDownIcon,
  ThumbUpIcon,
  TodayBriefCard,
  type MoreAction,
} from '@/components/ai/AiExtras';
import { useClientConfig } from '@/features/home/useAppConfig';

const ENDPOINT = isNativePlatform() ? 'https://www.sirimillavinay.online/api/vinaxai' : '/api/vinaxai';
/* The live free-model menu for the two engines that open a whole catalog
   instead of one fixed model (v5.21.0). Fetched only when the picker asks. */
const MODELS_ENDPOINT = isNativePlatform() ? 'https://www.sirimillavinay.online/api/aimodels' : '/api/aimodels';
/* Which speech models the key serves right now — see functions/api/voices.ts. */
const VOICES_ENDPOINT = isNativePlatform() ? 'https://www.sirimillavinay.online/api/voices' : '/api/voices';
/* Flip to true the day the account gets a real image model — the whole
   pipeline (endpoint, chat branch, button) is wired and waiting. */
const IMAGES_ENABLED = false;
const IMG_ENDPOINT = isNativePlatform() ? 'https://www.sirimillavinay.online/api/image' : '/api/image';

const speechForSpoken = (md: string): string =>
  md
    .replace(/```[\s\S]*?```/g, ' code block ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '$1')
    .replace(/[#>*_]/g, '')
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '')
    .replace(/\uFE0F/g, '')
    .slice(0, 2000);
const STORE_KEY = 'vinax_ai_chats_v1';
/* Which catalog a seat opens, and one model row inside it. */
type CatalogGroupId = 'grq' | 'opr';
interface CatalogModel {
  id: string;
  label: string;
  context: number | null;
}
type CatalogPicks = Partial<Record<CatalogGroupId, string>>;
const CATALOG_PICK_KEY = 'vinax.aiCatalogModels';
/* Spoken-reply voice. 'device' = the browser's own speech engine (always
   available, works offline); anything else is a served speech model plus a
   persona. Stored as one string so a half-set preference is impossible. */
const VOICE_PICK_KEY = 'vinax.aiVoice';
const DEVICE_VOICE = 'device';
interface VoiceCatalog {
  configured: boolean;
  models: CatalogModel[];
  personas: Array<{ id: string; label: string; tone: string }>;
}
/** A model's own name out of its slug — vendor prefix and routing suffix are
 *  plumbing, not a name. Mirrors catalogLabel() on the server so a saved pick
 *  reads correctly on the chip before the menu has ever been fetched. */
const slugLabel = (id: string): string =>
  (id.includes('/') ? id.slice(id.lastIndexOf('/') + 1) : id).replace(/:(free|beta|extended|nitro|floor)$/i, '').trim() || id;

type Mode = 'muse' | 'swift' | 'sage' | 'scholar' | 'win' | 'nova' | 'nano' | 'auto' | 'pro' | 'mini' | 'k3' | 'translator' | 'glimmer' | 'flash' | 'musegl' | 'ising15' | 'laguna' | 'gemma4' | 'router';
// Engine picker: six plain-English seats up front — the ones a listener
// actually chooses between — and every other live engine under Advanced, each
// still wearing its owner-chosen name. Ids stay stable for the API.
// v5.21.0 — retuned to the rotated key set: the retired seats are gone (old
// stored picks are remapped server-side), a general all-rounder took the
// reserve seat, and the two seats marked `catalog` open a live list of every
// free model that key serves (fetched from /api/aimodels).
const MODES: Array<{ id: Mode; label: string; hint: string; tier: 'core' | 'advanced'; catalog?: CatalogGroupId }> = [
  { id: 'auto', label: 'Auto', hint: 'Picks the best engine for each question', tier: 'core' },
  { id: 'muse', label: 'Balanced', hint: 'Everyday chat · recommended', tier: 'core' },
  { id: 'swift', label: 'Fast', hint: 'Quickest answers · VinaX OAI OSS 20B', tier: 'core' },
  { id: 'sage', label: 'Deep', hint: 'Careful reasoning · VinaX NVD NMTRN SUP', tier: 'core' },
  { id: 'win', label: 'Creative', hint: 'Ideas, lyrics, stories · VinaX NVD NMTRN 3.5 LTNG 30B', tier: 'core' },
  { id: 'translator', label: 'Translate', hint: 'Translation specialist · 12+ languages', tier: 'core' },
  // Advanced — the owner's live models under their own names.
  { id: 'nova', label: 'VinaX NVD NMTRN ULT', hint: 'Most powerful · complex questions', tier: 'advanced' },
  { id: 'nano', label: 'VinaX NVD NMTRN NN OMNI 30B', hint: 'Light and quick · song finder', tier: 'advanced' },
  { id: 'pro', label: 'VinaX DP V4 PRO', hint: 'Deep analysis · advanced reasoning', tier: 'advanced' },
  { id: 'flash', label: 'VinaX DP V4 FLASH', hint: 'Rapid generalist', tier: 'advanced' },
  { id: 'mini', label: 'VinaX MST NMTRN', hint: 'Dependable all-rounder', tier: 'advanced' },
  { id: 'scholar', label: 'VinaX GRQ ALL', hint: 'Music knowledge · instant answers', tier: 'advanced', catalog: 'grq' },
  { id: 'router', label: 'VinaX OPR ALL', hint: 'Free model marketplace · pick any engine', tier: 'advanced', catalog: 'opr' },
  { id: 'k3', label: 'VinaX K3', hint: 'Premium agent · heavyweight generalist', tier: 'advanced' },
  { id: 'glimmer', label: 'VinaX GGL DIF GEM 26B A4B IT', hint: 'Visual-creative · moods and themes', tier: 'advanced' },
  { id: 'musegl', label: 'VinaX MTA MUSE GMR 30B', hint: 'Playful creative sparks', tier: 'advanced' },
  { id: 'gemma4', label: 'VinaX GGL GEM 4 31B', hint: 'Open generalist', tier: 'advanced' },
  { id: 'laguna', label: 'VinaX PSD LGNA XS 2.1', hint: 'Small and swift', tier: 'advanced' },
  { id: 'ising15', label: 'VinaX NVD ING CALBTN 1.5 31B', hint: 'Rankings and comparisons', tier: 'advanced' },
];
// Engine ids retired by the 2026-09-09 key rotation. A listener whose stored
// pick names one keeps their nearest living seat instead of silently landing
// on the default (the server maps them too — this just keeps the UI honest
// about which chip is lit).
const RETIRED_MODE: Record<string, Mode> = { omni: 'nano', ising135: 'ising15', cgt120: 'swift', minimax: 'mini' };
/** The model to send with a request: only the two catalog seats carry one,
 *  and only when the listener actually picked a row (otherwise the seat runs
 *  its own default engine). */
const catalogModelForSend = (m: Mode, picks: CatalogPicks): string | undefined => {
  const group = MODES.find((mm) => mm.id === m)?.catalog;
  return group ? picks[group] : undefined;
};
const CORE_MODES = MODES.filter((m) => m.tier === 'core');
const ADVANCED_MODES = MODES.filter((m) => m.tier === 'advanced');
// Engine chip on each reply: which engine actually answered (from stream meta) —
// derived from the served model slug so failovers are reported honestly.
// Order matters: specific slugs sit BEFORE the generic llama/vision row.
const ENGINE_NICK: Array<[RegExp, string]> = [
  // v5.4.0 engines (probe-verified pins) — specific slugs sit first so the
  // legacy rows below can never mislabel them.
  [/nemotron-3\.5-lightning/i, 'VinaX NVD NMTRN 3.5 LTNG 30B'],
  [/nemotron-3-super-120b/i, 'VinaX NVD NMTRN SUP'],
  [/deepseek-v4-pro/i, 'VinaX DP V4 PRO'],
  [/deepseek-v4-flash/i, 'VinaX DP V4 FLASH'],
  [/mistral-nemotron/i, 'VinaX MST NMTRN'],
  [/kimi/i, 'VinaX K3'],
  [/diffusiongemma/i, 'VinaX GGL DIF GEM 26B A4B IT'],
  [/muse-glimmer/i, 'VinaX MTA MUSE GMR 30B'],
  [/gemma-4/i, 'VinaX GGL GEM 4 31B'],
  [/laguna/i, 'VinaX PSD LGNA XS 2.1'],
  [/ising-calibration/i, 'VinaX NVD ING CALBTN 1.5 31B'],
  [/nano-omni/i, 'VinaX NVD NMTRN NN OMNI 30B'],
  [/llama-3\.2-90b-vision/i, 'VinaX MTA VSN 90B'],
  [/llama-3\.2-11b-vision/i, 'VinaX MTA VSN 11B'],
  // A marketplace pick keeps its own name: the listener chose that engine by
  // name, so the chip must not relabel it as something else.
  [/:free$/i, 'VinaX OPR ALL'],
  // Retired seats — old stored replies still label cleanly.
  [/minimax/i, 'VinaX AI'],
  // The chip reports the engine that actually answered, keyed off the served
  // slug — so a reply rescued by the ladder never wears the seat's name
  // (nickname != model). The retired rows below keep old stored replies
  // labelling cleanly instead of falling through to the generic catch-all.
  [/gpt-oss-120b/i, 'VinaX AI'],
  [/gpt-oss-20b/i, 'VinaX OAI OSS 20B'],
  // v5.6.2 — legacy catch-rows renamed to the owner nicknames too, so EVERY
  // chip in the app speaks the same names (old stored slugs included).
  [/nemotron-super|nemotron.super/i, 'VinaX NVD NMTRN SUP'],
  [/nemotron-3-ultra|nemotron.ultra/i, 'VinaX NVD NMTRN ULT'],
  [/nemotron-3-nano|diffusiongemma|gemma/i, 'VinaX NVD NMTRN NN OMNI 30B'],
  // Retired slugs from repo history (inkling/qwen/old deepseeks) — generic label.
  [/inkling|qwen|deepseek/i, 'VinaX AI'],
  [/llama-3\.3-70b|llama-3\.1-8b|vision|llama/i, 'VinaX GRQ ALL'],
];
const nickForModel = (model: string): string => {
  for (const [re, nick] of ENGINE_NICK) if (re.test(model)) return nick;
  return 'VinaX AI';
};

// Trending-flavoured starter pool — 4 are drawn at random per visit/new chat,
// with the listener's pinned language woven in. Never the same wall twice.
// v5.11.0 — feature buttons: one tap sets up the prompt (and the right seat).
const QUICK_ACTIONS: Array<{ icon: string; label: string; prompt: string; mode?: Mode }> = [
  { icon: '✍️', label: 'Write', prompt: 'Write a ', mode: 'win' },
  { icon: '💻', label: 'Code', prompt: 'Write code that ', mode: 'sage' },
  { icon: '📊', label: 'Chart', prompt: 'Make a chart of ' },
  { icon: '🧭', label: 'Diagram', prompt: 'Draw a diagram of ' },
  { icon: '🌐', label: 'Translate', prompt: 'Translate to Telugu: ', mode: 'translator' },
  { icon: '📄', label: 'Summarise', prompt: 'Summarise this: ' },
  { icon: '🎵', label: 'Songs', prompt: 'Recommend songs for ' },
  { icon: '🧠', label: 'Explain', prompt: 'Explain simply: ' },
];
const STARTER_POOL: Array<(l: string) => string> = [
  (l) => `Suggest 5 ${l} songs for a rainy evening`,
  (l) => `Write a heartfelt birthday wish in ${l}`,
  (l) => `Translate "How are you doing?" into ${l}`,
  () => 'Explain quantum computing simply',
  () => 'Write a Python script that renames photos by date taken, with tests',
  () => 'Chart: India smartphone market share by brand, 2025',
  () => 'Draw a flowchart of how a web request reaches a database',
  () => 'Plan a 3-day trip to Goa on a budget',
  () => 'Write an Instagram caption for a sunset photo',
  () => 'Help me write a professional leave email',
  () => '5 easy dinner recipes for tonight',
  () => 'Give me a 20-minute home workout',
  () => 'Compare React, Vue and Svelte in a table',
  () => "What's trending in tech news today?",
];

interface Msg {
  role: 'user' | 'assistant';
  content: string;
  images?: string[];
  sources?: string[];
  /** Nickname of the engine that answered (from stream meta). */
  engine?: string;
  /** Render as a live mini-player card (music commands). */
  player?: boolean;
  /** Listener feedback on this reply. */
  rating?: 'up' | 'down';
  /** v5.16.0 — pinned to the top of the chat. */
  pinned?: boolean;
  /** v5.16.0 — follow-up questions the engine suggested. */
  followups?: string[];
}
interface Conversation {
  id: string;
  title: string;
  messages: Msg[];
  updatedAt: number;
  pinned?: boolean;
}

function groupChats(chats: Conversation[], q: string): Array<[string, Conversation[]]> {
  const query = q.trim().toLowerCase();
  const filtered = query
    ? chats.filter(
        (c) =>
          c.title.toLowerCase().includes(query) ||
          c.messages.some((m) => m.content.toLowerCase().includes(query)),
      )
    : chats;
  const today = new Date().setHours(0, 0, 0, 0);
  const groups: Array<[string, Conversation[]]> = [
    ['Pinned', []],
    ['Today', []],
    ['Yesterday', []],
    ['Previous 7 days', []],
    ['Older', []],
  ];
  for (const c of filtered) {
    if (c.pinned) groups[0][1].push(c);
    else if (c.updatedAt >= today) groups[1][1].push(c);
    else if (c.updatedAt >= today - 86_400_000) groups[2][1].push(c);
    else if (c.updatedAt >= today - 7 * 86_400_000) groups[3][1].push(c);
    else groups[4][1].push(c);
  }
  return groups.filter(([, list]) => list.length > 0);
}

const uid = (): string =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}_${Math.random().toString(36).slice(2)}`;
const freshChat = (): Conversation => ({ id: uid(), title: 'New chat', messages: [], updatedAt: Date.now() });

// v5.18.0 — presentational helpers for the redesigned shell: the sidebar
// row's "last touched" stamp and the welcome greeting split so the time
// word (or the listener's name) can carry the gradient accent.
const relTime = (ts: number): string => {
  const d = Date.now() - ts;
  if (d < 60_000) return 'Just now';
  if (d < 3_600_000) return `${Math.floor(d / 60_000)}m ago`;
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)}h ago`;
  if (d < 7 * 86_400_000) return `${Math.floor(d / 86_400_000)}d ago`;
  return new Date(ts).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
};
const greetingParts = (): [string, string] => {
  const h = new Date().getHours();
  return ['Good', h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening'];
};

function loadChats(): Conversation[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORE_KEY);
    const arr = raw ? (JSON.parse(raw) as Conversation[]) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}
// Strip base64 image data URLs from messages before persisting: they live in
// React state only, so a chat with 3-4 attachments never bloats localStorage
// past the ~5MB quota. Placeholders keep the message shape stable for reload.
function stripImagesForPersist(chats: Conversation[]): Conversation[] {
  return chats.map((c) => ({
    ...c,
    messages: c.messages.map((m) =>
      m.images && m.images.length
        ? { ...m, images: m.images.map(() => '') }
        : m,
    ),
  }));
}
function persist(chats: Conversation[]): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(stripImagesForPersist(chats).slice(0, 50)));
  } catch {
    /* storage full or blocked — non-fatal */
  }
}

// ---------- file helpers ----------
const readAsDataURL = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result));
    fr.onerror = () => reject(new Error('read failed'));
    fr.readAsDataURL(file);
  });
const readAsText = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result));
    fr.onerror = () => reject(new Error('read failed'));
    fr.readAsText(file);
  });

// small inline icons not in the shared set
const MicIcon = ({ className }: { className?: string }): ReactNode => (
  <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden>
    <rect x="9" y="3" width="6" height="11" rx="3" fill="currentColor" />
    <path d="M5 11a7 7 0 0 0 14 0M12 18v3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>
);
const SendIcon = ({ className }: { className?: string }): ReactNode => (
  <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden>
    <path d="M12 20V5M6 11l6-6 6 6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const StopIcon = ({ className }: { className?: string }): ReactNode => (
  <svg viewBox="0 0 24 24" className={className} aria-hidden>
    <rect x="6" y="6" width="12" height="12" rx="2.5" fill="currentColor" />
  </svg>
);
const MenuIcon = ({ className }: { className?: string }): ReactNode => (
  <svg viewBox="0 0 24 24" className={className} aria-hidden>
    <path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>
);
const TrashIcon = ({ className }: { className?: string }): ReactNode => (
  <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden>
    <path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

interface Pending {
  kind: 'image' | 'text';
  name: string;
  dataUrl?: string;
  text?: string;
}
export default function VinaXAIPage(): ReactNode {
  const [chats, setChats] = useState<Conversation[]>(() => {
    const saved = loadChats();
    // v5.11.1 — at most one empty "New chat" survives a reload; earlier
    // builds let every New-chat tap stack another blank entry.
    const kept: Conversation[] = [];
    let blank = false;
    for (const c of saved) {
      if (c.messages.length === 0) {
        if (blank) continue;
        blank = true;
      }
      kept.push(c);
    }
    return kept.length ? kept : [freshChat()];
  });
  const [activeId, setActiveId] = useState<string>(() => '');
  const [input, setInput] = useState('');
  const [mode, setMode] = useState<Mode>(() => {
    try {
      const saved = localStorage.getItem('vinax.aiDefaultMode') ?? '';
      if (MODES.some((mm) => mm.id === saved)) return saved as Mode;
      // Engine ids saved by older builds map to their closest successor.
      const legacy: Record<string, Mode> = { maverick: 'muse', diffusion: 'muse', medium: 'muse', fast: 'swift', deep: 'sage', gemma: 'scholar' };
      if (legacy[saved]) return legacy[saved];
      if (RETIRED_MODE[saved]) return RETIRED_MODE[saved];
    } catch {
      /* default */
    }
    return 'muse';
  });
  // The live free-model catalogs, and the listener's pick inside each. Both
  // start empty: the menu is fetched the first time an engine list is opened,
  // and an engine nobody has opened costs nothing.
  const [catalogs, setCatalogs] = useState<Record<CatalogGroupId, CatalogModel[]>>({ grq: [], opr: [] });
  const [catalogState, setCatalogState] = useState<'idle' | 'loading' | 'ready' | 'failed'>('idle');
  // Voice: `${model}|${persona}`, or DEVICE_VOICE. Read once; the engine
  // re-reads the ref on every chunk so a change applies to the next sentence.
  const [voicePick, setVoicePick] = useState<string>(() => {
    try {
      return localStorage.getItem(VOICE_PICK_KEY) || DEVICE_VOICE;
    } catch {
      return DEVICE_VOICE;
    }
  });
  const [voiceCatalog, setVoiceCatalog] = useState<VoiceCatalog | null>(null);
  const [catalogPicks, setCatalogPicks] = useState<CatalogPicks>(() => {
    try {
      const raw = JSON.parse(localStorage.getItem(CATALOG_PICK_KEY) ?? '{}') as CatalogPicks;
      return raw && typeof raw === 'object' ? raw : {};
    } catch {
      return {};
    }
  });
  const [chatQuery, setChatQuery] = useState('');
  const [renaming, setRenaming] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  // v5.11.0 — personal profile: what the assistant should know about you.
  const [profile, setProfile] = useState<string>(() => {
    try {
      return localStorage.getItem('vinax.aiProfile') ?? '';
    } catch {
      return '';
    }
  });
  const userName = useMemo(() => {
    try {
      return (JSON.parse(localStorage.getItem('vinax.user-name') ?? '""') as string) || '';
    } catch {
      return '';
    }
  }, []);
  const [fontSize, setFontSize] = useState<'s' | 'm' | 'l'>(() => {
    try {
      return (localStorage.getItem('vinax.aiFontSize') as 's' | 'm' | 'l') ?? 'm';
    } catch {
      return 'm';
    }
  });
  const [engineOpen, setEngineOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [web, setWeb] = useState(false);
  // Composer capability toggles (v2.4.0): Think routes the next messages to
  // the deep lane (high effort); Research forces multi-source web answers.
  const [think, setThink] = useState(false);
  const [research, setResearch] = useState(false);
  // v5.16.0 — reply preferences (remembered), now-playing context, prompt
  // library, read-aloud state, slash menu.
  const [replyLang, setReplyLang] = useState<string>(() => { try { return localStorage.getItem('vinax.aiReplyLang') ?? 'auto'; } catch { return 'auto'; } });
  const [replyStyle, setReplyStyle] = useState<string>(() => { try { return localStorage.getItem('vinax.aiReplyStyle') ?? 'auto'; } catch { return 'auto'; } });
  const [songCtx, setSongCtx] = useState(false);
  const [promptsOpen, setPromptsOpen] = useState(false);
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const currentSong = useCurrentSong();
  useEffect(() => onSpeakingChange(setSpeakingId), []);
  useEffect(() => { try { localStorage.setItem('vinax.aiReplyLang', replyLang); localStorage.setItem('vinax.aiReplyStyle', replyStyle); } catch { /* ignore */ } }, [replyLang, replyStyle]);
  const [imageMode, setImageMode] = useState(false);
  const [pending, setPending] = useState<Pending[]>([]);
  const [busy, setBusy] = useState(false);
  const themePref = useSettingsStore((st) => st.theme);
  useEffect(() => {
    // Standalone route: the main layout's theme effect never runs here.
    applyThemeClasses(resolveTheme(themePref, window.matchMedia('(prefers-color-scheme: dark)').matches));
  }, [themePref]);
  // v5.10.1 — no deterrence on the AI page: text selects, images drag,
  // right-click opens the browser menu (the document listeners in
  // utils/deterrence.ts exempt this route; the class carries the CSS side).
  useEffect(() => {
    const root = document.documentElement;
    const had = root.classList.contains('deter');
    root.classList.remove('deter');
    return () => {
      if (had) root.classList.add('deter');
    };
  }, []);
  const [listening, setListening] = useState(false);
  const [micNote, setMicNote] = useState('');
  const [voiceMode, setVoiceMode] = useState(false);
  const [voiceState, setVoiceState] = useState<LiveVoiceState>('idle');
  const [voiceMuted, setVoiceMuted] = useState(false);
  const [voiceUserCaption, setVoiceUserCaption] = useState('');
  const [voiceAiCaption, setVoiceAiCaption] = useState('');
  const [voiceNotice, setVoiceNotice] = useState('');
  const [voiceError, setVoiceError] = useState('');
  const voiceLevelRef = useRef(0);
  const voiceWaveRef = useRef<Uint8Array | null>(null);
  const voiceEngineRef = useRef<LiveVoiceEngine | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const abortRef = useRef<AbortController | null>(null);

  // Keyboard shortcuts: ⌘/Ctrl+K = new chat · Esc = stop generation.
  // Ref-forward the current impl so the handler (attached once) never closes
  // over a stale copy of newChat/stop.
  const newChatRef = useRef<() => void>(() => undefined);
  const stopRef = useRef<() => void>(() => undefined);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        newChatRef.current();
      }
      if (e.key === 'Escape') stopRef.current();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
  const recRef = useRef<SttSession | null>(null);
  const dictNoResultRef = useRef<number>(0);
  const listRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  // stable-ish refs so speech callbacks read latest values
  const stateRef = useRef({ mode, web, think, research, profile, replyLang, replyStyle, songCtx, currentSong, catalogPicks });
  stateRef.current = { mode, web, think, research, profile, replyLang, replyStyle, songCtx, currentSong, catalogPicks };

  // Which catalog (if any) the current seat opens, and the model chosen in it.
  const catalogGroup = MODES.find((mm) => mm.id === mode)?.catalog ?? null;
  const pickedCatalogModel = catalogGroup ? (catalogPicks[catalogGroup] ?? '') : '';
  // What the composer chip reads: the seat's name normally, but the chosen
  // model's own name once one is picked from a free menu.
  // Derived from the slug, not from the fetched list, so a pick saved in an
  // earlier session labels correctly without waiting on a network round-trip.
  const activeEngineLabel = pickedCatalogModel
    ? slugLabel(pickedCatalogModel)
    : (MODES.find((mm) => mm.id === mode)?.label ?? 'Engine');

  /** Load the free-model menu once per visit, on first demand. A failure is
   *  reported as such — the picker says the list is unavailable rather than
   *  showing a stale or invented menu, and the seat still answers on its
   *  default engine. */
  const loadCatalogs = useCallback(() => {
    setCatalogState((prev) => {
      if (prev !== 'idle' && prev !== 'failed') return prev;
      void fetch(MODELS_ENDPOINT)
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error('bad response'))))
        .then((j: { groups?: Array<{ id?: string; models?: CatalogModel[] }> }) => {
          const next: Record<CatalogGroupId, CatalogModel[]> = { grq: [], opr: [] };
          for (const g of j.groups ?? []) {
            if ((g.id === 'grq' || g.id === 'opr') && Array.isArray(g.models)) next[g.id] = g.models;
          }
          setCatalogs(next);
          setCatalogState('ready');
        })
        .catch(() => setCatalogState('failed'));
      return 'loading';
    });
  }, []);

  // The engine reads this on every spoken chunk, so changing the voice in
  // Settings takes effect on the next sentence, not the next session.
  const voicePickRef = useRef(voicePick);
  voicePickRef.current = voicePick;
  /** What the voice route should use for the next chunk: null means speak on
   *  this device (the browser engine), which is also the answer when no
   *  speech model is served. */
  const serverVoice = useCallback((): { model: string; voice: string } | null => {
    const v = voicePickRef.current;
    if (!v || v === DEVICE_VOICE) return null;
    const [model, voice] = v.split('|');
    return model && voice ? { model, voice } : null;
  }, []);

  // Read aloud speaks through the same chosen voice as live chat. Registered
  // once; the getter reads the ref, so a change in Settings applies to the
  // next chunk rather than the next reply.
  useEffect(() => {
    setReadAloudVoice(serverVoice);
    return () => setReadAloudVoice(null);
  }, [serverVoice]);

  /** Ask the server which speech models the key actually serves. Loaded when
   *  the settings menu first opens, so a listener who never opens it pays
   *  nothing. An empty answer is shown as such — never a guessed voice. */
  const loadVoices = useCallback(() => {
    setVoiceCatalog((prev) => {
      if (prev) return prev;
      void fetch(VOICES_ENDPOINT)
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error('bad response'))))
        .then((j: VoiceCatalog) =>
          setVoiceCatalog({
            configured: Boolean(j.configured),
            models: Array.isArray(j.models) ? j.models : [],
            personas: Array.isArray(j.personas) ? j.personas : [],
          }),
        )
        .catch(() => setVoiceCatalog({ configured: false, models: [], personas: [] }));
      return prev;
    });
  }, []);

  /** Persist the chosen voice. */
  const pickVoice = useCallback((v: string) => {
    setVoicePick(v);
    try {
      localStorage.setItem(VOICE_PICK_KEY, v);
    } catch {
      /* private mode */
    }
  }, []);

  /** Remember the model chosen inside a catalog seat, per seat. */
  const pickCatalogModel = useCallback((group: CatalogGroupId, id: string) => {
    setCatalogPicks((prev) => {
      const next: CatalogPicks = { ...prev };
      if (id) next[group] = id;
      else delete next[group];
      try {
        localStorage.setItem(CATALOG_PICK_KEY, JSON.stringify(next));
      } catch {
        /* private mode */
      }
      return next;
    });
  }, []);

  useEffect(() => {
    if (!activeId) setActiveId(chats[0]?.id ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Debounced persist: every streamed SSE delta bumps `chats`, so writing
  // synchronously on each update thrashes localStorage. Coalesce to one write
  // per 500ms of quiet, and force-flush on tab hide so nothing is lost.
  useEffect(() => {
    const t = setTimeout(() => persist(chats), 500);
    return () => clearTimeout(t);
  }, [chats]);
  useEffect(() => {
    const onHide = (): void => persist(chats);
    window.addEventListener('pagehide', onHide);
    return () => window.removeEventListener('pagehide', onHide);
  }, [chats]);
  // Auto-scroll to the newest reply on chat changes, but ONLY if the user
  // is already near the bottom. The old effect had no dep array and ran on
  // every render (including every SSE delta and every keystroke in the
  // input), which yanked users back to the bottom while they were re-reading
  // an earlier reply (audit finding M1).
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const nearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 80;
    if (nearBottom) list.scrollTo({ top: list.scrollHeight });
  }, [chats, activeId]);

  const active = useMemo(() => chats.find((c) => c.id === activeId) ?? chats[0], [chats, activeId]);

  // Browser tab mirrors the open conversation, like any serious chat app.
  const chatTitle = active && active.messages.length && active.title !== 'New chat' ? active.title : null;
  usePageMeta({
    title: chatTitle ?? 'VinaX AI — ask anything',
    description:
      'Chat with VinaX AI — ask anything, search the live web, and get clean answers with code, tables and images. Free, private, no login.',
    canonicalPath: '/VinaXAI',
  });

  // Fresh draw of 4 starters per visit and per new chat.
  // v5.15.0 — the console can add starters (Admin → AI Starter Prompts) and
  // replace the quick-action chips (Admin → AI Quick Actions).
  const clientCfg = useClientConfig();
  const quickActions = useMemo(
    () => (clientCfg?.aiQuick.length ? clientCfg.aiQuick.map((q) => ({ ...q, mode: q.mode as Mode | undefined })) : QUICK_ACTIONS),
    [clientCfg],
  );
  const starters = useMemo(() => {
    const raw = useSettingsStore.getState().pinnedLanguages[0] ?? 'telugu';
    const lang = raw.charAt(0).toUpperCase() + raw.slice(1);
    const pool: Array<(l: string) => string> = [
      ...STARTER_POOL,
      ...(clientCfg?.aiStarters ?? []).map((t) => (l: string) => t.replace(/\{lang\}/g, l)),
    ];
    const picks: string[] = [];
    while (picks.length < 4 && pool.length) {
      const i = Math.floor(Math.random() * pool.length);
      picks.push(pool.splice(i, 1)[0](lang));
    }
    return picks;
    // The chat id is a deliberate re-roll trigger: new chat = new starters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.id, clientCfg]);
  const messages = active?.messages ?? [];

  const togglePin = (id: string): void =>
    setChats((prev) => prev.map((c) => (c.id === id ? { ...c, pinned: !c.pinned } : c)));

  const renameChat = (id: string, title: string): void =>
    setChats((prev) => prev.map((c) => (c.id === id ? { ...c, title: title.trim() || c.title } : c)));

  const chatToMarkdown = (c: Conversation): string =>
    `# ${c.title}\n\n` +
    c.messages.map((m) => (m.role === 'user' ? `**You:** ${m.content}` : `**VinaX AI:**\n\n${m.content}`)).join('\n\n---\n\n');

  const downloadFile = (name: string, text: string, mime: string): void => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: mime }));
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const exportChat = (kind: 'txt' | 'md' | 'pdf'): void => {
    if (!active) return;
    const stem = active.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase() || 'chat';
    if (kind === 'md') {
      downloadFile(`${stem}.md`, chatToMarkdown(active), 'text/markdown');
      return;
    }
    if (kind === 'txt') {
      const txt = active.messages.map((m) => `${m.role === 'user' ? 'You' : 'VinaX AI'}: ${m.content}`).join('\n\n');
      downloadFile(`${stem}.txt`, txt, 'text/plain');
      return;
    }
    const w = window.open('', '_blank');
    if (!w) return;
    const esc = (t: string) =>
      t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    w.document.write(
      `<html><head><title>${esc(active.title)}</title><style>body{font-family:-apple-system,system-ui,sans-serif;max-width:720px;margin:2rem auto;padding:0 1rem;line-height:1.6}h1{font-size:1.4rem}.u{font-weight:700;margin-top:1.2rem}.a{white-space:pre-wrap;margin-top:.4rem}</style></head><body><h1>${esc(active.title)}</h1>` +
        active.messages
          .map((m) => (m.role === 'user' ? `<p class="u">You: ${esc(m.content)}</p>` : `<div class="a">${esc(m.content)}</div>`))
          .join('') +
        '</body></html>',
    );
    w.document.close();
    // Firefox races the print dialog against document.close(): scheduling
    // print() a tick later lets the new window actually render first.
    setTimeout(() => {
      try {
        w.print();
      } catch {
        /* window closed before we could print */
      }
    }, 100);
  };

  const exportAll = (): void => {
    downloadFile('vinax-ai-chats.json', JSON.stringify(chats, null, 2), 'application/json');
  };

  const rateReply = (idx: number, rating: 'up' | 'down'): void => {
    setActiveMessages((prev) => prev.map((m, k) => (k === idx ? { ...m, rating: m.rating === rating ? undefined : rating } : m)));
  };

  const regenerate = (): void => {
    const msgs = active?.messages ?? [];
    if (busy || msgs.length < 2) return;
    const lastUser = [...msgs].reverse().find((m) => m.role === 'user');
    if (!lastUser) return;
    const previousReply = [...msgs].reverse().find((m) => m.role === 'assistant')?.content ?? '';
    void sendRef.current(lastUser.content, { history: msgs.slice(0, msgs.lastIndexOf(lastUser)), previousReply, user: lastUser });
  };

  const continueReply = (): void => {
    if (!busy) void sendRef.current('Continue exactly from where you stopped.');
  };

  const editPrompt = (idx: number, content: string): void => {
    if (busy) return;
    setActiveMessages((prev) => prev.slice(0, idx));
    setInput(content);
  };

  // v5.16.0 — reply actions: rewrite the last answer, pin, branch.
  const rewriteLast = (how: 'shorter' | 'longer' | 'simpler'): void => {
    if (busy) return;
    const ask = how === 'shorter' ? 'Rewrite your last answer at half the length, keeping every fact.' : how === 'longer' ? 'Expand your last answer with more detail and examples, same structure.' : 'Rewrite your last answer in simpler words, as if for someone new to the topic.';
    void sendRef.current(ask);
  };
  const togglePinMsg = (idx: number): void => setActiveMessages((prev) => prev.map((m, k) => (k === idx ? { ...m, pinned: !m.pinned } : m)));
  const branchFrom = (idx: number): void => {
    const src = active;
    if (!src) return;
    const c: Conversation = { ...freshChat(), title: `${src.title} · branch`, messages: src.messages.slice(0, idx + 1).map((m) => ({ ...m, pinned: undefined })) };
    setChats((prev) => [c, ...prev]);
    setActiveId(c.id);
    setSidebarOpen(false);
  };

  const setActiveMessages = (fn: (prev: Msg[]) => Msg[]): void => {
    setChats((prev) =>
      prev.map((c) => (c.id === (active?.id ?? '') ? { ...c, messages: fn(c.messages), updatedAt: Date.now() } : c)),
    );
  };

  const newChat = (): void => {
    // Reuse an existing blank chat instead of stacking another one.
    const blank = chats.find((c) => c.messages.length === 0);
    if (blank) {
      setActiveId(blank.id);
      setInput('');
      setPending([]);
      setSidebarOpen(false);
      taRef.current?.focus();
      return;
    }
    const c = freshChat();
    setChats((prev) => [c, ...prev]);
    setActiveId(c.id);
    setInput('');
    setPending([]);
    setSidebarOpen(false);
  };
  const deleteChat = (id: string): void => {
    setChats((prev) => {
      const next = prev.filter((c) => c.id !== id);
      const list = next.length ? next : [freshChat()];
      if (id === activeId) setActiveId(list[0].id);
      return list;
    });
  };

  const stop = (): void => {
    abortRef.current?.abort();
    abortRef.current = null;
    setBusy(false);
  };
  newChatRef.current = newChat;
  stopRef.current = stop;

  // Spoken (or typed) music commands run instantly — no AI round-trip.
  const pushExchange = (userText: string, reply: string, player = false): void => {
    setActiveMessages((prev) => [
      ...prev,
      { role: 'user', content: userText },
      player ? { role: 'assistant', content: reply, player: true } : { role: 'assistant', content: reply },
    ]);
  };

  const tryMusicCommand = async (text: string): Promise<boolean> => {
    const t = text.toLowerCase().replace(/[.!?]+$/, '').trim();
    const say = (line: string): void => {
      pushExchange(text, line, true);
      voiceEngineRef.current?.speakDirect(line);
    };
    if (/^(pause|stop)(\s+(the\s+)?(music|song|playback))?$/.test(t)) {
      const st = usePlayerStore.getState();
      if (st.isPlaying) st.togglePlay();
      say('Paused.');
      return true;
    }
    if (/^(resume|continue)(\s+(the\s+)?(music|song|playing|playback))?$/.test(t)) {
      const st = usePlayerStore.getState();
      if (!st.isPlaying && st.queue.length) st.togglePlay();
      say('Resuming your music.');
      return true;
    }
    if (/^(next|skip)(\s+(this\s+)?(song|track))?$/.test(t)) {
      usePlayerStore.getState().next(true);
      say('Skipping to the next song.');
      return true;
    }
    if (/^(previous|go back)(\s+(song|track))?$/.test(t)) {
      usePlayerStore.getState().prev();
      say('Going back a song.');
      return true;
    }
    // Package B4 — sub-intent parser layered on top of the play command.
    // Supports:
    //   play X                       — plays X immediately (existing)
    //   queue X                      — enqueues X after the current song
    //   start X / put on X           — synonyms of play
    //   shuffle X / shuffle songs by X — plays a shuffled batch matching X
    //   similar to X / more like X    — startRadio() on the first match
    //   play X in <language>          — filters results by language
    //   play X without <artist>       — drops any result by that artist
    const playPattern = /^(?:play|queue|start|put on|shuffle|similar to|more like)\s+(.+)$/i;
    const cmd = playPattern.exec(text.trim());
    if (cmd) {
      const verb = (cmd[0].match(/^(play|queue|start|put on|shuffle|similar to|more like)/i)?.[1] ?? 'play').toLowerCase();
      let rest = cmd[1].trim();
      // Strip trailing filler ("play X song / music / now / please")
      rest = rest.replace(/\s+(?:song|music|now|please)$/i, '').trim();

      // Extract "in <language>" filter.
      let langFilter: string | null = null;
      const langMatch = rest.match(/\s+in\s+([a-z]+)$/i);
      if (langMatch) {
        langFilter = langMatch[1].toLowerCase();
        rest = rest.slice(0, langMatch.index).trim();
      }

      // Extract "without <artist>" exclusion.
      let excludeArtist: string | null = null;
      const withoutMatch = rest.match(/\s+without\s+(.+)$/i);
      if (withoutMatch) {
        excludeArtist = withoutMatch[1].toLowerCase().trim();
        rest = rest.slice(0, withoutMatch.index).trim();
      }

      // "shuffle songs by X" — allow "shuffle songs by AR Rahman" style.
      const shuffleByMatch = rest.match(/^songs?\s+by\s+(.+)$/i);
      if (shuffleByMatch) rest = shuffleByMatch[1].trim();

      if (rest.length > 1) {
        try {
          const rawResults = await searchSongs(rest, verb === 'shuffle' ? 15 : 8);
          let results = rawResults;
          if (langFilter) {
            const matches = results.filter((s) => (s.language ?? '').toLowerCase().startsWith(langFilter));
            if (matches.length) results = matches; // fall through to unfiltered if no language match
          }
          if (excludeArtist) {
            results = results.filter((s) => !s.subtitle.toLowerCase().includes(excludeArtist));
          }
          if (!results.length) {
            say(`I couldn't find “${rest}” — try the song name with the artist.`);
            return true;
          }
          const player = usePlayerStore.getState();
          if (verb === 'queue') {
            player.enqueueNext(results[0]);
            say(`Queued ${results[0].title} by ${results[0].subtitle}.`);
          } else if (verb === 'shuffle') {
            const shuffled = [...results].sort(() => Math.random() - 0.5);
            player.playQueue(shuffled, 0);
            say(`Shuffling ${shuffled.length} tracks from ${rest}.`);
          } else if (verb === 'similar to' || verb === 'more like') {
            player.startRadio(results[0]);
            say(`Starting a radio like ${results[0].title}.`);
          } else {
            player.playQueue(results, 0);
            const langBit = langFilter ? ` (in ${langFilter})` : '';
            const excludeBit = excludeArtist ? ` (skipping ${excludeArtist})` : '';
            say(`Playing ${results[0].title} by ${results[0].subtitle}${langBit}${excludeBit}.`);
          }
          return true;
        } catch {
          /* search down — let the AI answer instead */
          return false;
        }
      }
    }
    return false;
  };

  // v5.16.0 — slash commands run on the device; a few seed an engine prompt.
  const runSlash = async (cmd: string, arg: string): Promise<boolean> => {
    const song = stateRef.current.currentSong;
    switch (cmd) {
      case 'clear': newChat(); return true;
      case 'export': setExportOpen(true); return true;
      case 'prompts': setPromptsOpen(true); return true;
      case 'think': setThink((v) => !v); return true;
      case 'web': setWeb((v) => !v); return true;
      case 'now':
        pushExchange('/now', song ? `Now playing: ${song.title} — ${song.artists?.[0]?.name ?? song.subtitle}` : 'Nothing is playing right now.', !!song);
        return true;
      case 'mood':
        if (!arg) { pushExchange('/mood', 'Tell me a mood — try “/mood chill” or “/mood energetic”.'); return true; }
        return tryMusicCommand(`play ${arg} songs`);
      case 'summary':
        void sendRef.current('Summarise this conversation so far in five short bullets, then list any decisions or action items.');
        return true;
      case 'lyrics':
        if (!song) { pushExchange('/lyrics', 'Play a song first, then ask again.'); return true; }
        setSongCtx(true);
        void sendRef.current(`Explain the meaning of “${song.title}” — what the lyrics are about, the mood, and any lines worth noticing. Keep it warm and brief.`);
        return true;
      case 'playlist': {
        if (!arg) { pushExchange('/playlist', 'Describe a vibe — try “/playlist rainy evening in Telugu”.'); return true; }
        const langs = useSettingsStore.getState().pinnedLanguages;
        const muted = useSettingsStore.getState().mutedLanguages ?? [];
        setActiveMessages((prev) => [...prev, { role: 'user', content: `/playlist ${arg}` }, { role: 'assistant', content: '' }]);
        setBusy(true);
        try {
          const r = await generatePlaylist(arg, langs, muted);
          const ok = r.ok ? r.playlist : null;
          const lines = ok ? ok.songs.map((sg, i) => `${i + 1}. ${sg.title} — ${sg.artists?.[0]?.name ?? sg.subtitle}`).join('\n') : '';
          const reply = ok && ok.songs.length ? `**${ok.name}**\n${ok.description}\n\n${lines}` : 'I couldn’t build that playlist right now — try a different vibe or a moment later.';
          setActiveMessages((prev) => { const next = [...prev]; next[next.length - 1] = { role: 'assistant', content: reply }; return next; });
        } catch {
          setActiveMessages((prev) => { const next = [...prev]; next[next.length - 1] = { role: 'assistant', content: 'The playlist engine didn’t answer — try again in a moment.' }; return next; });
        }
        setBusy(false);
        return true;
      }
      default: return false;
    }
  };

  const send = async (raw: string, retry?: { history: Msg[]; previousReply: string; user: Msg }): Promise<void> => {
    const conversation = retry?.history ?? messages;
    const q = raw.trim();
    if ((!q && pending.length === 0) || busy) return;
    const slash = !retry && pending.length === 0 ? parseSlash(q) : null;
    if (slash) {
      setInput('');
      if (await runSlash(slash.cmd, slash.arg)) return;
    }
    if (!retry && q && pending.length === 0 && (await tryMusicCommand(q))) {
      setInput('');
      return;
    }

    // 🎨 image mode: one prompt → one picture, rendered in the chat.
    if (imageMode && !retry) {
      if (!q) return;
      setInput('');
      setImageMode(false);
      setBusy(true);
      setActiveMessages((prev) => [...prev, { role: 'user', content: q }, { role: 'assistant', content: '' }]);
      try {
        const r = await fetch(IMG_ENDPOINT, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ prompt: q }),
        });
        const j = (await r.json().catch(() => null)) as { image?: string; error?: string } | null;
        const reply: Msg = j?.image
          ? { role: 'assistant', content: 'Here you go 🎨', images: [j.image] }
          : {
              role: 'assistant',
              content:
                j?.error === 'not_enabled' || j?.error === 'model_unavailable'
                  ? 'Image creation isn’t enabled on the server yet — everything else still works.'
                  : 'The image engine didn’t answer — try once more in a moment.',
            };
        setActiveMessages((prev) => {
          const next = [...prev];
          next[next.length - 1] = reply;
          return next;
        });
      } catch {
        setActiveMessages((prev) => {
          const next = [...prev];
          next[next.length - 1] = { role: 'assistant', content: 'The image engine didn’t answer — try once more in a moment.' };
          return next;
        });
      }
      setBusy(false);
      return;
    }
    const imgs = retry ? retry.user.images ?? [] : pending.filter((p) => p.kind === 'image' && p.dataUrl).map((p) => p.dataUrl as string);
    const textFiles = retry ? [] : pending.filter((p) => p.kind === 'text' && p.text);
    let content = q;
    for (const f of textFiles) content += `\n\n--- ${f.name} ---\n${(f.text ?? '').slice(0, 40_000)}`;

    setInput('');
    setPending([]);
    if (taRef.current) taRef.current.style.height = 'auto';

    const userMsg: Msg = { role: 'user', content: content || '(image)', images: imgs.length ? imgs : undefined };
    setActiveMessages(() => [...conversation, userMsg, { role: 'assistant', content: '' }]);
    setChats((prev) =>
      prev.map((c) =>
        c.id === (active?.id ?? '') && (c.title === 'New chat' || !c.messages.length)
          ? { ...c, title: (q || 'Image chat').slice(0, 42) }
          : c,
      ),
    );

    const voiceLive = Boolean(voiceEngineRef.current);
    // Think/Research ride the same override path voice uses: a leading rule
    // message plus (for Think) a per-message lane override to the deep engine.
    const thinkNow = !voiceLive && stateRef.current.think;
    const researchNow = !voiceLive && stateRef.current.research;
    // v5.16.0 — reply preferences + song context (now playing, pasted links).
    const prefRule = voiceLive ? '' : prefRuleMessage(stateRef.current.replyLang, stateRef.current.replyStyle);
    const ctxBlocks: string[] = [];
    if (!voiceLive) {
      const np = stateRef.current.songCtx ? stateRef.current.currentSong : null;
      if (np) ctxBlocks.push(await songContextBlock(np, 'now playing').catch(() => ''));
      for (const id of detectSongLinks(q)) {
        const sg = await getSong(id).catch(() => null);
        if (sg) ctxBlocks.push(await songContextBlock(sg, 'song the user linked').catch(() => ''));
      }
    }
    const apiMessages = [
      ...(prefRule ? [{ role: 'user' as const, content: prefRule }] : []),
      ...ctxBlocks.filter(Boolean).map((content) => ({ role: 'user' as const, content })),
      ...(voiceLive
        ? [{ role: 'user' as const, content: 'SYSTEM RULE for this voice conversation: every reply is spoken aloud — 1-3 short conversational sentences of plain text, no markdown, no lists, no emojis.' }]
        : []),
      ...(thinkNow
        ? [{ role: 'user' as const, content: 'SYSTEM RULE for this reply: reason it through privately first, then present a short structured summary of the key steps followed by a clear final answer. Raw chain-of-thought never appears in the reply.' }]
        : []),
      ...(researchNow
        ? [{ role: 'user' as const, content: 'SYSTEM RULE for this reply: research mode. Work from the web results, cross-check at least two independent sources, flag where they disagree, and tie each key fact to the source that backs it.' }]
        : []),
      ...conversation,
      userMsg,
      ...(retry?.previousReply ? [
        { role: 'assistant' as const, content: retry.previousReply.slice(0, 12000) },
        { role: 'user' as const, content: 'Regenerate your answer to my last question. Take a meaningfully different approach, preserve correct facts, and avoid the songs you just recommended. Deliver the new answer directly.' },
      ] : []),
    ].map((mm) => ({ role: mm.role, content: mm.content }));
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);
    let full = '';
    let gotSources: string[] = [];
    let gotEngine = '';
    // Time-sensitive queries — "who won today", "202X releases", live scores,
    // weather — auto-flip web search on so the reply gets fresh sources
    // instead of the model's training-time snapshot. The heuristic used to
    // live server-side but was moved here so users always see the "web on"
    // badge when a live-web hop happens (see server-side audit finding M18).
    const freshTrigger = /\b(today|tonight|yesterday|this (?:week|month|year|weekend|season)|right now|as of (?:now|today)|breaking(?: news)?|who won|live scores?|box office|standings|weather|price of|stock price|202[6-9]|latest|recently released)\b/i.test(q);
    try {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(isNativePlatform() ? { 'x-vinax-client': 'app' } : {}) },
        body: JSON.stringify({
          messages: apiMessages,
          // Think overrides the lane to the deep engine (high effort) for this message.
          mode: voiceEngineRef.current ? 'voice' : thinkNow ? 'sage' : stateRef.current.mode,
          // Catalog seats only: the exact free model the listener picked. The
          // server re-checks it against the provider's live free list, and
          // every other seat ignores it entirely.
          model: catalogModelForSend(stateRef.current.mode, stateRef.current.catalogPicks),
          // Research always searches, and multi-source rules are prepended above.
          web: stateRef.current.web || researchNow || freshTrigger,
          images: imgs,
          // B5 — the snapshot plus this thread's own memory: everything the
          // assistant already recommended in this conversation, so "give me
          // more" turns reach into fresh territory instead of looping.
          taste: { ...buildTasteSnapshot(), alreadyRecommendedThisChat: extractRecommendedFromThread(retry ? [...conversation, { role: 'assistant', content: retry.previousReply }] : conversation, 32) },
          profile: stateRef.current.profile || undefined,
        }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) throw new Error('bad response');
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let sep = buf.indexOf('\n\n');
        while (sep >= 0) {
          const chunk = buf.slice(0, sep).trim();
          buf = buf.slice(sep + 2);
          sep = buf.indexOf('\n\n');
          if (!chunk.startsWith('data:')) continue;
          try {
            const j = JSON.parse(chunk.slice(5).trim()) as {
              delta?: string;
              done?: boolean;
              meta?: { sources?: string[]; model?: string };
            };
            if (j.meta?.sources?.length) gotSources = j.meta.sources;
            if (j.meta?.model) gotEngine = nickForModel(j.meta.model);
            if (typeof j.delta === 'string') {
              full += j.delta;
              voiceEngineRef.current?.feed(j.delta);
              const snapshot = full;
              setActiveMessages((prev) => {
                const next = [...prev];
                for (let k = next.length - 1; k >= 0; k -= 1) {
                  if (next[k].role === 'assistant') {
                    next[k] = { ...next[k], content: snapshot };
                    break;
                  }
                }
                return next;
              });
            }
          } catch {
            /* skip malformed SSE frame */
          }
        }
      }
    } catch {
      if (!full) full = 'The assistant paused — please try again.';
    } finally {
      abortRef.current = null;
      setBusy(false);
      const split = splitFollowups(full.trim().replace(/\n{3,}/g, '\n\n'));
      const finalText = split.body;
      const finalSources = gotSources;
      const finalEngine = gotEngine;
      setActiveMessages((prev) => {
        const next = [...prev];
        for (let k = next.length - 1; k >= 0; k -= 1) {
          if (next[k].role === 'assistant') {
            next[k] = {
              ...next[k],
              content: finalText || '…',
              sources: finalSources.length ? finalSources : undefined,
              engine: finalEngine || undefined,
              followups: split.followups.length ? split.followups : undefined,
            };
            break;
          }
        }
        return next;
      });
      if (voiceEngineRef.current) {
        if (finalText) voiceEngineRef.current.finish(finalText);
        else voiceEngineRef.current.cancelTurn();
      }
    }
  };

  const sendRef = useRef(send);
  sendRef.current = send;

  const startListening = (auto: boolean): void => {
    if (!sttSupported()) {
      setMicNote('Voice input isn’t supported here — try Chrome, or the VinaX app on Android.');
      return;
    }
    // Inside the tap: get the on-device route ready (model install needs the
    // gesture) — the fallback that keeps working when the server route is dead.
    // (Web only — a harmless no-op on native, where the plugin listens.)
    prepareLocalRecognition('en-IN');
    setMicNote('');
    recRef.current?.abort();
    recRef.current = null;
    const attempt = (useLocal: boolean, retried: boolean): void => {
      const startedAt = Date.now();
      let sawAudio = false;
      let gotAnyResult = false;
      const clearWatchdog = (): void => {
        if (dictNoResultRef.current) {
          window.clearTimeout(dictNoResultRef.current);
          dictNoResultRef.current = 0;
        }
      };
      const session = createSttSession(
        { lang: 'en-IN', processLocally: useLocal },
        {
          onAudioStart: () => {
            sawAudio = true;
          },
          onInterim: (t) => {
            gotAnyResult = true;
            clearWatchdog();
            setMicNote('');
            setInput(t);
          },
          onEnd: (finalText, fatal) => {
            clearWatchdog();
            if (recRef.current !== session) return;
            recRef.current = null;
            const said = finalText.trim();
            if (fatal) {
              setMicNote(
                fatal === 'denied'
                  ? 'Microphone access is blocked — allow the mic for VinaX, then try again.'
                  : 'Voice input didn’t start — try again in a moment.',
              );
            } else if (!said && !sawAudio && Date.now() - startedAt < 1500) {
              // Instant silent end = dead speech service (diagnosed live): retry
              // once on the on-device route, otherwise say what's wrong.
              if (!retried && !useLocal && localRecognitionState() === 'ready') {
                attempt(true, true);
                return;
              }
              setMicNote(
                localRecognitionState() === 'installing' || localRecognitionState() === 'checking'
                  ? 'Preparing voice input (one-time download) — try again in a moment.'
                  : 'Mic input didn’t start — check microphone permission for VinaX.',
              );
            } else if (!said && sawAudio && !gotAnyResult) {
              // Audio flowed for the whole window but no result ever came —
              // the speech service is silent. Tell the user honestly.
              setMicNote('Voice input didn’t hear anything — check the mic and try again.');
            }
            setListening(false);
            if (said && auto) void sendRef.current(said);
          },
        },
      );
      if (!session) {
        setListening(false);
        setMicNote('Voice input didn’t start — try again in a moment.');
        return;
      }
      recRef.current = session;
      setListening(true);
      // Silent-service watchdog: no result for 8s → stop gracefully so onEnd
      // surfaces an honest message instead of an eternal "Listening…".
      clearWatchdog();
      dictNoResultRef.current = window.setTimeout(() => {
        if (recRef.current !== session || gotAnyResult) return;
        session.stop();
      }, 8000);
    };
    attempt(localRecognitionState() === 'ready', false);
  };
  const stopListening = (): void => {
    recRef.current?.stop();
    if (dictNoResultRef.current) {
      window.clearTimeout(dictNoResultRef.current);
      dictNoResultRef.current = 0;
    }
    setListening(false);
  };

  const startVoice = (): void => {
    if (voiceEngineRef.current) return;
    stopListening();
    setVoiceError('');
    setVoiceMuted(false);
    setVoiceUserCaption('');
    setVoiceAiCaption('');
    const engine = new LiveVoiceEngine(
      {
        lang: 'en-IN',
        getVoice: () => pickSynthVoice('en-IN'),
        toSpoken: speechForSpoken,
        // Package B6 — barge-in: interrupt the reply the moment you start
        // talking. Guarded by a grace period + echo filter in the engine. If a
        // specific device ever talks over itself, flip this to false.
        bargeIn: true,
        getServerVoice: serverVoice,
      },
      {
        onState: (st) => {
          setVoiceState(st);
          if (st === 'listening') setVoiceAiCaption('');
          // Defensive re-wire: the overlay must always render THIS engine's bins.
          voiceWaveRef.current = engine.waveBins;
        },
        onLevel: (l) => {
          voiceLevelRef.current = l;
        },
        onUserInterim: (t) => setVoiceUserCaption(t),
        onUserFinal: (t) => {
          setVoiceUserCaption(t);
          void sendRef.current(t);
        },
        onAssistantCaption: (t) => {
          setVoiceAiCaption(t);
          setVoiceUserCaption('');
        },
        onNotice: (t) => setVoiceNotice(t),
        onFatal: (reason) => {
          setVoiceError(
            reason === 'denied'
              ? 'Microphone access is blocked — allow the mic for this site, then try again.'
              : reason === 'unsupported'
                ? 'This browser does not support voice chat — Chrome works best.'
                : reason === 'no-tts'
                  ? 'Speaking isn’t working in this browser — the reply is above, try text mode.'
                  : 'The browser speech service isn’t responding — try again in a moment or type instead.',
          );
          voiceEngineRef.current?.destroy();
        },
      },
    );
    voiceEngineRef.current = engine;
    setVoiceMode(true);
    setVoiceState('listening');
    engine.start();
    // Wire the waveform AFTER start() so the overlay reads the live bins.
    voiceWaveRef.current = engine.waveBins;
  };

  const endVoice = (): void => {
    stop();
    voiceEngineRef.current?.destroy();
    voiceEngineRef.current = null;
    voiceWaveRef.current = null;
    setVoiceMode(false);
    setVoiceState('idle');
    setVoiceError('');
    setVoiceUserCaption('');
    setVoiceAiCaption('');
    setVoiceNotice('');
  };

  const onFiles = async (files: FileList | null): Promise<void> => {
    if (!files) return;
    const add: Pending[] = [];
    for (const file of Array.from(files).slice(0, 8)) {
      if (file.type.startsWith('image/')) {
        try {
          add.push({ kind: 'image', name: file.name, dataUrl: await readAsDataURL(file) });
        } catch {
          /* skip unreadable image */
        }
      } else if (file.size < 2_000_000) {
        try {
          add.push({ kind: 'text', name: file.name, text: await readAsText(file) });
        } catch {
          /* skip unreadable file */
        }
      }
    }
    setPending((prev) => [...prev, ...add].slice(0, 8));
    if (fileRef.current) fileRef.current.value = '';
  };

  // Voice everywhere (v3.3.0): web uses the Web Speech API; the Android app
  // uses the system recognizer via the native plugin (the WebView's bare
  // webkitSpeechRecognition shell — the old force-close — is never touched;
  // the stt module dispatches on platform first). The async probe refines the
  // native answer once the device confirms a recognition service exists.
  const [sttReady, setSttReady] = useState<boolean>(() => sttSupported());
  useEffect(() => {
    void probeSttSupport().then(setSttReady);
  }, []);
  const canSpeech = sttReady;

  const greeting = greetingParts();
  const isEmpty = messages.length === 0;

  // The composer is rendered in ONE of two places — centred under the
  // greeting on an empty chat, pinned to the bottom once a thread exists —
  // so it is built once here and placed below. Duplicating this JSX would
  // mean two copies of every handler.
  const composerBlock = (
    <div className={cn('shrink-0', isEmpty ? 'px-0' : 'px-3 sm:px-6 pt-1 pb-[max(0.75rem,env(safe-area-inset-bottom))]')}>
          <div className="mx-auto w-full max-w-[720px]">
            {pending.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-2 px-1">
                {pending.map((p, i) => (
                  <span key={i} className="ai-chip pl-1.5 pr-1 py-1 gap-1.5">
                    {p.kind === 'image' && p.dataUrl ? (
                      <img src={p.dataUrl} alt="" className="w-6 h-6 rounded-md object-cover" />
                    ) : (
                      <span className="w-6 h-6 rounded-md bg-[var(--ai-hover)] flex items-center justify-center text-[9px] font-bold ai-t3" aria-hidden>TXT</span>
                    )}
                    <span className="max-w-[10rem] truncate">{p.name}</span>
                    <button
                      aria-label="Remove"
                      onClick={() => setPending((prev) => prev.filter((_, k) => k !== i))}
                      className="ai-icon-btn w-6 h-6 ai-t3"
                    >
                      <XIcon className="w-3.5 h-3.5" />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div className="ai-composer relative px-2.5 pt-3 pb-2">
              <SlashMenu items={matchSlash(input)} onPick={(c: SlashCommand) => { setInput(c.arg ? `/${c.cmd} ` : `/${c.cmd}`); taRef.current?.focus(); if (!c.arg) void send(`/${c.cmd}`); }} />
              <input
                ref={fileRef}
                type="file"
                multiple
                accept="image/*,.txt,.md,.markdown,.csv,.tsv,.json,.log,.xml,.yml,.yaml,.toml,.ini,.env.example,.html,.htm,.css,.js,.jsx,.ts,.tsx,.py,.java,.kt,.c,.h,.cpp,.cs,.go,.rs,.rb,.php,.sh,.sql,.r,.swift,.dart"
                className="hidden"
                onChange={(e) => void onFiles(e.target.files)}
              />
              <textarea
                ref={taRef}
                value={input}
                onChange={(e) => {
                  setInput(e.target.value);
                  const t = e.target;
                  t.style.height = 'auto';
                  t.style.height = `${Math.min(t.scrollHeight, 144)}px`;
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Tab' && input.startsWith('/') && !/\s/.test(input)) {
                    const first = matchSlash(input)[0];
                    if (first) { e.preventDefault(); setInput(first.arg ? `/${first.cmd} ` : `/${first.cmd}`); }
                    return;
                  }
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    void send(input);
                  }
                }}
                rows={1}
                placeholder={imageMode ? 'Describe the image to create…' : listening ? 'Listening…' : 'Message VinaX AI… (type / for commands)'}
                aria-label="Message VinaX AI"
                className="w-full bg-transparent resize-none outline-none px-2 text-[15px] leading-6 max-h-36 ai-t1 placeholder:opacity-55"
              />
              <div className="mt-1.5 flex items-center gap-0.5">
                <button
                  onClick={() => fileRef.current?.click()}
                  aria-label="Add photos or files"
                  className="ai-icon-btn"
                  title="Add photos & files"
                >
                  <PlusIcon className="w-[18px] h-[18px]" />
                </button>
                <button
                  onClick={() => setWeb((v) => !v)}
                  aria-pressed={web}
                  aria-label="Web search"
                  title="Web search"
                  className={cn('ai-icon-btn', web && 'ai-icon-btn-on')}
                >
                  <GlobeIcon className="w-[18px] h-[18px]" />
                </button>
                {IMAGES_ENABLED && (
                <button
                  onClick={() => setImageMode((v) => !v)}
                  aria-pressed={imageMode}
                  aria-label="Create an image"
                  title="Create an image from your next message"
                  className={cn('ai-icon-btn text-base leading-none', imageMode && 'ai-icon-btn-on')}
                >
                  <span aria-hidden>🎨</span>
                </button>
                )}
                {canSpeech && (
                  <button
                    onClick={voiceMode ? endVoice : startVoice}
                    aria-pressed={voiceMode}
                    aria-label="Live voice chat"
                    title="Live voice chat"
                    className={cn('ai-icon-btn', voiceMode && 'ai-icon-btn-on')}
                  >
                    <WaveformIcon className="w-[18px] h-[18px]" />
                  </button>
                )}
                <span className="flex-1" />
                {canSpeech && (
                  <button
                    onClick={() => (listening ? stopListening() : startListening(false))}
                    aria-label="Voice input"
                    aria-pressed={listening}
                    title="Speak"
                    className={cn('ai-icon-btn', listening && 'ai-icon-btn-on animate-pulse')}
                  >
                    <MicIcon className="w-[18px] h-[18px]" />
                  </button>
                )}
                {busy ? (
                  <button onClick={stop} aria-label="Stop" className="ai-send ml-1" style={{ background: 'var(--ai-text)', color: 'var(--ai-bg)' }}>
                    <StopIcon className="w-4 h-4" />
                  </button>
                ) : (
                  <button
                    onClick={() => void send(input)}
                    disabled={!input.trim() && pending.length === 0}
                    aria-label="Send"
                    className="ai-send ml-1"
                  >
                    <SendIcon className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>

            {/* mode + capability-toggle row */}
            <div className="mt-2 flex flex-wrap items-center justify-between gap-x-2 gap-y-1 px-1">
              <div className="flex items-center gap-1.5 min-w-0">
              <div className="relative">
                <button
                  onClick={() => {
                    setEngineOpen((v) => !v);
                    // The free-model menu is fetched on first open, never on
                    // page load — a listener who stays on a fixed seat pays
                    // nothing for engines they never look at.
                    loadCatalogs();
                  }}
                  aria-haspopup="listbox"
                  aria-expanded={engineOpen}
                  className={cn('ai-chip py-1.5 gap-1.5 ai-t1', engineOpen && 'ai-chip-on')}
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-ember-400" aria-hidden />
                  {/* On a catalog seat the listener chose an actual model —
                      show THAT name, so the chip never claims a generic seat
                      is answering when a specific engine is. */}
                  <span className="truncate max-w-[11rem]">{activeEngineLabel}</span>
                  <ChevronDownIcon className={cn('w-3 h-3 ai-t3 transition-transform', engineOpen && 'rotate-180')} />
                </button>
                {engineOpen && (
                  <>
                    <button
                      aria-label="Close engine menu"
                      onClick={() => setEngineOpen(false)}
                      className="fixed inset-0 z-40 cursor-default"
                    />
                    <div
                      role="listbox"
                      aria-label="Choose engine"
                      /* The composer sits mid-screen on an empty chat and at
                         the bottom once a thread starts, so the menu has to
                         open away from the composer in each case — anchored
                         upward always, it ran off the top of the landing. */
                      className={cn(
                        'ai-popover absolute left-0 z-50 w-72 overflow-y-auto overscroll-contain animate-fade-up',
                        isEmpty ? 'top-full mt-2' : 'bottom-full mb-2',
                      )}
                      /* Inline cap, immune to CSS purging: the engine list —
                         and the free-model menu under a catalog seat — must
                         scroll inside the popover, never spill off-screen. */
                      style={{ maxHeight: 'min(62vh, 460px)' }}
                    >
                      <p className="px-2.5 pt-1.5 pb-1 text-[10px] font-bold uppercase tracking-widest ai-t3">Engine</p>
                      {CORE_MODES.map((mm) => (
                        <button
                          key={mm.id}
                          role="option"
                          aria-selected={mode === mm.id}
                          onClick={() => {
                            setMode(mm.id);
                            setEngineOpen(false);
                          }}
                          className="ai-menu-item justify-between gap-3"
                        >
                          <span className="min-w-0">
                            <span className="block text-[13px] font-bold truncate">{mm.label}</span>
                            <span className="block text-[11px] font-medium ai-t3 truncate">{mm.hint}</span>
                          </span>
                          {mode === mm.id && <span aria-hidden className="text-ember-400">✓</span>}
                        </button>
                      ))}
                      <button
                        onClick={() => setAdvancedOpen((v) => !v)}
                        aria-expanded={advancedOpen}
                        className="w-full flex items-center justify-between px-2.5 py-2 mt-1 border-t ai-hairline text-[10px] font-bold uppercase tracking-widest ai-t3 hover:ai-t1"
                      >
                        Advanced engines
                        <ChevronDownIcon className={cn('w-3 h-3 transition-transform', advancedOpen && 'rotate-180')} />
                      </button>
                      {advancedOpen &&
                        ADVANCED_MODES.map((mm) => (
                          <button
                            key={mm.id}
                            role="option"
                            aria-selected={mode === mm.id}
                            onClick={() => {
                              setMode(mm.id);
                              if (!mm.catalog) setEngineOpen(false);
                            }}
                            className="ai-menu-item justify-between gap-3 py-1.5"
                          >
                            <span className="min-w-0">
                              <span className="block font-mono text-[12px] truncate">{mm.label}</span>
                              <span className="block text-[11px] font-medium ai-t3 truncate">{mm.hint}</span>
                            </span>
                            {mode === mm.id && <span aria-hidden className="text-ember-400">✓</span>}
                          </button>
                        ))}
                      {/* The two catalog seats open a whole free menu: pick the
                          exact model, or leave it on the seat's default. */}
                      {catalogGroup && (
                        <div className="border-t ai-hairline mt-1 pt-1">
                          <p className="px-2.5 pb-1 text-[10px] font-bold uppercase tracking-widest ai-t3">
                            Model · free on this engine
                          </p>
                          {catalogState === 'loading' && (
                            <p className="px-2.5 pb-2 text-[11px] font-medium ai-t3">Loading the list…</p>
                          )}
                          {catalogState === 'failed' && (
                            <button
                              onClick={loadCatalogs}
                              className="ai-menu-item text-[11px] font-medium ai-t3"
                            >
                              Couldn’t load the list — tap to retry
                            </button>
                          )}
                          {catalogState === 'ready' && catalogs[catalogGroup].length === 0 && (
                            <p className="px-2.5 pb-2 text-[11px] font-medium ai-t3">
                              No free models available on this engine right now.
                            </p>
                          )}
                          <button
                            role="option"
                            aria-selected={!catalogPicks[catalogGroup]}
                            onClick={() => {
                              pickCatalogModel(catalogGroup, '');
                              setEngineOpen(false);
                            }}
                            className="ai-menu-item justify-between gap-3 py-1.5"
                          >
                            <span className="block text-[12px] font-semibold truncate">Default for this engine</span>
                            {!catalogPicks[catalogGroup] && <span aria-hidden className="text-ember-400">✓</span>}
                          </button>
                          {catalogs[catalogGroup].map((cm) => (
                            <button
                              key={cm.id}
                              role="option"
                              aria-selected={catalogPicks[catalogGroup] === cm.id}
                              onClick={() => {
                                pickCatalogModel(catalogGroup, cm.id);
                                setEngineOpen(false);
                              }}
                              className="ai-menu-item justify-between gap-3 py-1.5"
                            >
                              <span className="min-w-0">
                                <span className="block font-mono text-[12px] truncate">{cm.label}</span>
                                {cm.context !== null && (
                                  <span className="block text-[11px] font-medium ai-t3 truncate">
                                    {Math.round(cm.context / 1000)}k context
                                  </span>
                                )}
                              </span>
                              {catalogPicks[catalogGroup] === cm.id && <span aria-hidden className="text-ember-400">✓</span>}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
              <button
                onClick={() => setThink((v) => !v)}
                aria-pressed={think}
                title="Think — send the next message to the deep engine for careful reasoning"
                className={cn('ai-chip py-1.5 shrink-0', think && 'ai-chip-solid')}
              >
                Think
              </button>
              <button
                onClick={() => {
                  if (!research) setWeb(true);
                  setResearch((v) => !v);
                }}
                aria-pressed={research}
                title="Research — search the live web and cross-check multiple sources"
                className={cn('ai-chip py-1.5 shrink-0', research && 'ai-chip-solid')}
              >
                Research
              </button>
              </div>
              <div className="flex items-center gap-2 min-w-0 text-[11px] font-semibold">
                {micNote ? (
                  <span className="text-amber-500 dark:text-amber-400 truncate" role="status">
                    {micNote}
                  </span>
                ) : busy && think ? (
                  <span className="text-ember-400" role="status">
                    thinking deeply…
                  </span>
                ) : web ? (
                  <span className="text-ember-400">{research ? 'Research on' : 'Web search on'}</span>
                ) : (
                  <span className="hidden sm:inline ai-t3 font-medium">Enter to send · Shift+Enter for a new line</span>
                )}
              </div>
            </div>
          </div>
        </div>
  );


  return (
    /* Astra conversation surface, with theme-aware reading contrast. */
    <div className="ai-root h-[100dvh] w-full flex overflow-hidden">
      {/* Sidebar */}
      <aside
        aria-label="Chats"
        className={cn(
          'ai-panel flex-col w-[260px] shrink-0 border-r ai-hairline',
          sidebarOpen ? 'flex fixed inset-y-0 left-0 z-40 shadow-lift' : 'hidden',
          'md:flex md:static md:z-auto md:shadow-none',
        )}
      >
        <div className="flex items-center gap-2 px-3.5 pt-3.5 pb-2.5">
          <SparkleIcon className="w-[18px] h-[18px] shrink-0 text-ember-400" />
          <p className="text-[14px] font-bold tracking-tight ai-t1 flex-1 min-w-0">VinaX AI</p>
          <button onClick={() => setSidebarOpen(false)} aria-label="Close menu" className="ai-icon-btn md:hidden -mr-1">
            <XIcon className="w-4 h-4" />
          </button>
        </div>
        <div className="px-2.5">
          <button onClick={newChat} className="ai-btn w-full justify-start">
            <PlusIcon className="w-4 h-4" /> New chat
          </button>
        </div>
        <div className="px-2.5 pt-2 pb-1">
          <label className="ai-field flex items-center gap-2 px-2.5 py-1.5 ai-t3 focus-within:ai-t2">
            <SearchIcon className="w-3.5 h-3.5 shrink-0" />
            <input
              value={chatQuery}
              onChange={(e) => setChatQuery(e.target.value)}
              placeholder="Search chats"
              aria-label="Search chats"
              className="w-full min-w-0 bg-transparent text-[13px] outline-none ai-t1 placeholder:opacity-60"
            />
          </label>
        </div>
        <div className="flex-1 overflow-y-auto px-2 pb-2">
          {groupChats(chats, chatQuery).map(([label, list]) => (
            <div key={label}>
              <p className="ai-eyebrow px-2.5 pt-4 pb-1 flex items-center gap-1.5">
                {label === 'Pinned' && <StarIcon className="w-3 h-3" filled />}
                {label}
              </p>
              {list.map((c) => (
                <div
                  key={c.id}
                  className={cn('ai-side-row relative', c.id === active?.id && 'ai-side-row-on')}
                  onClick={() => {
                    setActiveId(c.id);
                    setSidebarOpen(false);
                  }}
                >
                  {c.id === active?.id && <span className="absolute left-0 top-1.5 bottom-1.5 w-[2px] rounded-full bg-ember-500/70" aria-hidden />}
                  {renaming === c.id ? (
                    <input
                      autoFocus
                      defaultValue={c.title}
                      onClick={(e) => e.stopPropagation()}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          renameChat(c.id, (e.target as HTMLInputElement).value);
                          setRenaming(null);
                        }
                        if (e.key === 'Escape') setRenaming(null);
                      }}
                      onBlur={(e) => {
                        renameChat(c.id, e.target.value);
                        setRenaming(null);
                      }}
                      className="ai-field flex-1 min-w-0 px-2 py-1 text-[13px] font-semibold ai-t1 outline-none"
                    />
                  ) : (
                    <span
                      className="min-w-0 flex-1"
                      onDoubleClick={(e) => {
                        e.stopPropagation();
                        setRenaming(c.id);
                      }}
                    >
                      <span className="block truncate text-[13px] font-semibold leading-tight">{c.title}</span>
                      <span className="block text-[11px] ai-t3 leading-tight mt-0.5">{relTime(c.updatedAt)}</span>
                    </span>
                  )}
                  <span className="ai-side-actions flex items-center shrink-0">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setRenaming(c.id);
                      }}
                      aria-label="Rename chat"
                      className="ai-icon-btn w-7 h-7 ai-t3"
                    >
                      <PencilIcon className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteChat(c.id);
                      }}
                      aria-label="Delete chat"
                      className="ai-icon-btn w-7 h-7 ai-t3 hover:text-red-400"
                    >
                      <TrashIcon className="w-3.5 h-3.5" />
                    </button>
                  </span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      togglePin(c.id);
                    }}
                    aria-label={c.pinned ? 'Unpin chat' : 'Pin chat'}
                    className={cn('ai-icon-btn w-7 h-7 shrink-0', c.pinned ? 'text-ember-400' : 'ai-side-actions ai-t3')}
                  >
                    <StarIcon className="w-3.5 h-3.5" filled={!!c.pinned} />
                  </button>
                </div>
              ))}
            </div>
          ))}
        </div>
        <div className="px-3 pt-2.5 pb-[max(0.75rem,env(safe-area-inset-bottom))] border-t ai-hairline">
          <Link to="/" className="ai-chip py-1.5 ai-t2" aria-label="Music">
            <span aria-hidden>♪</span> Music
          </Link>
        </div>
      </aside>

      {sidebarOpen && <button aria-label="Close menu" className="fixed inset-0 z-30 bg-black/50 md:hidden" onClick={() => setSidebarOpen(false)} />}
      {promptsOpen && (
        <SavedPromptsSheet draft={input} onClose={() => setPromptsOpen(false)} onUse={(t) => { setInput(t); taRef.current?.focus(); }} />
      )}
      {voiceMode && (
        <LiveVoiceOverlay
          state={voiceState}
          levelRef={voiceLevelRef}
          waveRef={voiceWaveRef}
          muted={voiceMuted}
          userCaption={voiceUserCaption || voiceNotice}
          aiCaption={voiceAiCaption}
          error={voiceError}
          voiceLabel=""
          onInterrupt={() => {
            stop();
            voiceEngineRef.current?.interrupt();
          }}
          onToggleMute={() => {
            const m = !voiceMuted;
            setVoiceMuted(m);
            voiceEngineRef.current?.setMuted(m);
          }}
          onEnd={endVoice}
        />
      )}

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header: the chat's name and nothing that competes with it. The
            engine now lives beside the composer, where it is chosen, instead
            of being repeated up here. */}
        <header className="flex items-center gap-1.5 px-3 sm:px-4 h-13 py-2.5 shrink-0">
          <button className="ai-icon-btn md:hidden" aria-label="Menu" onClick={() => setSidebarOpen(true)}>
            <MenuIcon className="w-[18px] h-[18px]" />
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="min-w-0 truncate text-[13.5px] font-semibold ai-t2">{active?.title ?? 'VinaX AI'}</h1>
            <p className="text-[11px] ai-t3 leading-tight truncate md:hidden">
              {activeEngineLabel}{think ? ' · Think' : ''}{voiceMode ? ' · Voice' : ''}
            </p>
          </div>
          <div className="relative">
            <button
              onClick={() => {
                setExportOpen((v) => !v);
                setSettingsOpen(false);
              }}
              aria-label="Export chat"
              title="Export chat"
              aria-expanded={exportOpen}
              className={cn('ai-icon-btn', exportOpen && 'ai-icon-btn-on')}
            >
              <DownloadIcon className="w-[18px] h-[18px]" />
            </button>
            {exportOpen && (
              <div className="ai-popover absolute right-0 top-full mt-1.5 z-50 w-48 animate-fade-up">
                {(['txt', 'md', 'pdf'] as const).map((k) => (
                  <button
                    key={k}
                    onClick={() => {
                      exportChat(k);
                      setExportOpen(false);
                    }}
                    className="ai-menu-item"
                  >
                    {k === 'txt' ? 'Plain text (.txt)' : k === 'md' ? 'Markdown (.md)' : 'PDF (print)'}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="relative">
            <button
              onClick={() => {
                setSettingsOpen((v) => !v);
                setExportOpen(false);
                // The voice list is fetched on first open, never on page load.
                loadVoices();
              }}
              aria-label="Chat settings"
              title="Chat settings"
              aria-expanded={settingsOpen}
              className={cn('ai-icon-btn', settingsOpen && 'ai-icon-btn-on')}
            >
              <SettingsIcon className="w-[18px] h-[18px]" />
            </button>
            {settingsOpen && (
              /* One settings menu, in sections, instead of settings here and
                 three dropdowns permanently parked above the composer. */
              <div className="ai-popover absolute right-0 top-full mt-1.5 z-50 w-[19rem] text-left animate-fade-up max-h-[75vh] overflow-y-auto">
                <p className="ai-eyebrow px-2 pt-1.5 pb-1">Replies</p>
                {!voiceMode && (
                  <ReplyPrefsBar
                    lang={replyLang}
                    style={replyStyle}
                    songCtx={songCtx}
                    hasSong={!!currentSong}
                    onLang={setReplyLang}
                    onStyle={setReplyStyle}
                    onSongCtx={setSongCtx}
                  />
                )}
                <div className="ai-menu-sep" />
                <p className="ai-eyebrow px-2 pb-1">Voice</p>
                <div className="px-2 pb-1">
                  <select
                    value={voicePick}
                    onChange={(e) => pickVoice(e.target.value)}
                    aria-label="Spoken reply voice"
                    className="ai-field w-full px-2.5 py-1.5 text-[12.5px] font-semibold outline-none ai-t1"
                  >
                    <option value={DEVICE_VOICE}>This device’s voice</option>
                    {/* One option per served speech model × persona. Nothing
                        is listed unless the key actually serves it, so a
                        choice here can never point at a model that 404s. */}
                    {(voiceCatalog?.models ?? []).map((m) => (
                      <optgroup key={m.id} label={m.label}>
                        {(voiceCatalog?.personas ?? []).map((pv) => (
                          <option key={`${m.id}|${pv.id}`} value={`${m.id}|${pv.id}`}>
                            {pv.label} · {pv.tone}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                  <p className="mt-1 text-[11px] ai-t3 leading-snug">
                    {voiceCatalog === null
                      ? 'Checking which voices are available…'
                      : voiceCatalog.models.length
                        ? 'Used for live voice chat and for Read aloud on a reply. Falls back to this device if a voice is briefly unavailable.'
                        : voiceCatalog.configured
                          ? 'No studio voice is available right now — replies are spoken by this device.'
                          : 'Studio voices aren’t configured — replies are spoken by this device.'}
                  </p>
                </div>
                <div className="ai-menu-sep" />
                <p className="ai-eyebrow px-2 pb-1">Default engine</p>
                <div className="px-2 pb-1">
                  <select
                    value={mode}
                    onChange={(e) => {
                      const v = e.target.value as Mode;
                      setMode(v);
                      try {
                        localStorage.setItem('vinax.aiDefaultMode', v);
                      } catch {
                        /* private mode */
                      }
                    }}
                    className="ai-field w-full px-2.5 py-1.5 text-[12.5px] font-semibold outline-none ai-t1"
                  >
                    <optgroup label="Engines">
                      {CORE_MODES.map((mm) => (
                        <option key={mm.id} value={mm.id}>
                          {mm.label}
                        </option>
                      ))}
                    </optgroup>
                    <optgroup label="Advanced">
                      {ADVANCED_MODES.map((mm) => (
                        <option key={mm.id} value={mm.id}>
                          {mm.label}
                        </option>
                      ))}
                    </optgroup>
                  </select>
                </div>
                <div className="ai-menu-sep" />
                <div className="ai-menu-item justify-between">
                  <span>Text size</span>
                  <span className="flex gap-1">
                    {(['s', 'm', 'l'] as const).map((f) => (
                      <button
                        key={f}
                        onClick={() => {
                          setFontSize(f);
                          try {
                            localStorage.setItem('vinax.aiFontSize', f);
                          } catch {
                            /* private mode */
                          }
                        }}
                        aria-pressed={fontSize === f}
                        className={cn('ai-chip px-2.5 py-1', fontSize === f && 'ai-chip-solid')}
                      >
                        {f.toUpperCase()}
                      </button>
                    ))}
                  </span>
                </div>
                <div className="ai-menu-sep" />
                <p className="ai-eyebrow px-2 pb-1">About you</p>
                <div className="px-2 pb-1">
                  <textarea
                    value={profile}
                    onChange={(e) => {
                      const v = e.target.value.slice(0, 1500);
                      setProfile(v);
                      try {
                        localStorage.setItem('vinax.aiProfile', v);
                      } catch {
                        /* private mode */
                      }
                    }}
                    rows={3}
                    placeholder="Name, what you do, languages you prefer, how you like answers… (stays on this device, sent with each message)"
                    className="ai-field w-full px-2.5 py-2 text-[12.5px] outline-none resize-none ai-t1 placeholder:opacity-55"
                  />
                </div>
                <div className="ai-menu-sep" />
                <div>
                  <button onClick={exportAll} className="ai-menu-item">
                    <DownloadIcon className="w-4 h-4" /> Export all chats (.json)
                  </button>
                  <button
                    onClick={() => {
                      if (window.confirm('Delete ALL chats stored on this device?')) {
                        const c = freshChat();
                        setChats([c]);
                        setActiveId(c.id);
                        setSettingsOpen(false);
                      }
                    }}
                    className="ai-menu-item ai-menu-item-danger"
                  >
                    <TrashIcon className="w-4 h-4" /> Clear all chats
                  </button>
                </div>
              </div>
            )}
          </div>
        </header>

        {/* Messages */}
        <div
          ref={listRef}
          className={cn('flex-1 overflow-y-auto ai-ambient', fontSize === 's' ? 'text-[13px]' : fontSize === 'l' ? 'text-[17px]' : 'text-[15px]')}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            void onFiles(e.dataTransfer.files);
          }}
        >
          {isEmpty ? (
            /* Landing: one column, vertically centred — greeting, then the
               composer directly beneath it (the thing you came to use), then
               everything optional below the fold of the eye. The old layout
               put nine chips and four cards between the greeting and the
               input, so the input was the last thing you found. */
            <div className="min-h-full flex flex-col justify-center px-5 py-10">
              <div className="mx-auto w-full max-w-[720px]">
                {/* greeting is ['Good', 'morning'|'afternoon'|'evening'] —
                    both halves always render; only the name is conditional. */}
                <div className="ai-astra-mark" aria-hidden="true"><SparkleIcon className="w-8 h-8" /></div>
                <p className="ai-astra-kicker">VINAX AI / ASTRA</p>
                <h2 className="ai-display text-center text-balance">
                  {greeting[0]} {greeting[1]}
                  {userName && (
                    <>
                      , <span className="ai-display-name">{userName}</span>
                    </>
                  )}
                </h2>
                <p className="ai-astra-subtitle">Where should we take your ideas today?</p>
                <div className="mt-7">{composerBlock}</div>
                <div className="mt-6 ai-scroll-x flex items-center gap-1.5 pb-1">
                  <button onClick={() => setPromptsOpen(true)} className="ai-chip shrink-0">
                    Saved prompts
                  </button>
                  {quickActions.map((qa) => (
                    <button
                      key={qa.label}
                      onClick={() => {
                        if (qa.mode) setMode(qa.mode);
                        setInput(qa.prompt);
                        taRef.current?.focus();
                      }}
                      className="ai-chip shrink-0"
                    >
                      {qa.label}
                    </button>
                  ))}
                </div>
                <div className="mt-5">
                  <TodayBriefCard onPick={(t) => void send(t)} />
                </div>
                <div className="mt-5">
                  <p className="ai-eyebrow mb-1">Try one</p>
                  <div className="ai-starter-grid">{starters.map((s) => (
                    <button key={s} onClick={() => void send(s)} className="ai-starter">
                      <span className="min-w-0">{s}</span>
                      <ArrowUpRightIcon className="w-3.5 h-3.5 ai-t3 shrink-0" />
                    </button>
                  ))}</div>
                </div>
              </div>
            </div>
          ) : (
            <div className="mx-auto w-full max-w-[720px] px-4 sm:px-6 py-6 space-y-6">
              {messages.some((m) => m.pinned) && (
                <div className="ai-card px-4 py-3 text-[12px]" aria-label="Pinned replies">
                  <p className="text-[10px] font-bold uppercase tracking-widest ai-t3 mb-1 flex items-center gap-1.5">
                    <PinIcon className="w-3 h-3 text-ember-400" /> Pinned
                  </p>
                  {messages.map((m, i) => m.pinned ? (
                    <button key={i} onClick={() => document.getElementById(`ai-msg-${i}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })} className="block w-full text-left truncate py-1 ai-t2 hover:ai-t1">
                      {m.content.replace(/[#*`>_]/g, '').slice(0, 110)}
                    </button>
                  ) : null)}
                </div>
              )}
              {messages.map((m, i) => {
                const last = i === messages.length - 1;
                const streaming = busy && last;
                const speakKey = `${active?.id ?? ''}:${i}`;
                const speaking = speakingId === speakKey;
                if (m.role === 'user') {
                  return (
                    <div key={i} id={`ai-msg-${i}`} className="ai-msg flex flex-col items-end animate-fade-up">
                      <div
                        className="ai-user-bubble max-w-[85%] sm:max-w-[75%] rounded-2xl rounded-br-md px-4 py-2.5 leading-relaxed"
                        onDoubleClick={() => editPrompt(i, m.content)}
                        title="Double-tap to edit & resend"
                      >
                        {m.images?.length ? (
                          <div className="flex flex-wrap gap-2 mb-2">
                            {m.images.map((src, k) => (
                              <img key={k} src={src} alt="attachment" className="w-24 h-24 object-cover rounded-lg" />
                            ))}
                          </div>
                        ) : null}
                        <p className="whitespace-pre-wrap">{m.content}</p>
                      </div>
                      {!busy && (
                        <div className="ai-toolbar mt-1 -mr-1">
                          <button onClick={() => editPrompt(i, m.content)} className="ai-tool">
                            <PencilIcon className="w-3 h-3" /> Edit
                          </button>
                        </div>
                      )}
                    </div>
                  );
                }
                const more: MoreAction[] = [];
                if (last) {
                  more.push(
                    { label: 'Regenerate', icon: <RefreshIcon />, onClick: regenerate },
                    { label: 'Continue', icon: <ContinueIcon />, onClick: continueReply },
                    { label: 'Shorten', icon: <ShortenIcon />, onClick: () => rewriteLast('shorter') },
                    { label: 'Expand', icon: <ExpandIcon />, onClick: () => rewriteLast('longer') },
                    { label: 'Simplify', icon: <SimplifyIcon />, onClick: () => rewriteLast('simpler') },
                  );
                }
                if (readAloudSupported()) {
                  more.push({ label: speaking ? 'Stop' : 'Listen', icon: <SpeakerIcon />, onClick: () => readAloud(speakKey, m.content), active: speaking });
                }
                more.push(
                  { label: m.pinned ? 'Unpin' : 'Pin', icon: <PinIcon />, onClick: () => togglePinMsg(i), active: !!m.pinned },
                  { label: 'Branch', icon: <BranchIcon />, onClick: () => branchFrom(i), title: 'Continue from this point in a new chat' },
                );
                return (
                  <div key={i} id={`ai-msg-${i}`} className="ai-msg flex gap-3 animate-fade-up">
                    <div className="flex flex-col items-center shrink-0 self-stretch">
                      <span
                        /* The mark, not a filled badge: in a long thread a
                           saturated circle per reply is the loudest thing on
                           the page and reads as decoration, not authorship. */
                        className={cn(
                          'w-5 h-5 flex items-center justify-center shrink-0 text-ember-400',
                          streaming && 'motion-safe:animate-[avatar-pulse_1.6s_ease-in-out_infinite]',
                        )}
                      >
                        <SparkleIcon className="w-[15px] h-[15px]" />
                      </span>
                      <span className="ai-thread-rail" aria-hidden />
                    </div>
                    <div className="min-w-0 flex-1 pt-0.5 leading-relaxed">
                      {m.images?.length ? (
                        <div className="flex flex-wrap gap-2 mb-2">
                          {m.images.map((src, k) => (
                            <img key={k} src={src} alt="attachment" className="w-24 h-24 object-cover rounded-lg" />
                          ))}
                        </div>
                      ) : null}
                      {m.player ? (
                        <ChatPlayerCard fallback={m.content} />
                      ) : m.content ? (
                        <>
                          {/* v5.6.0 — markdown renders LIVE while streaming
                              (headings, bold, lists, code, tables), exactly
                              like a chat assistant; RichContent streams safely
                              (an unclosed fence shows as preformatted text
                              until it completes).
                              v5.11.3 — ONE element type either way: swapping a
                              <div> for a bare <RichContent> at the same child
                              index made React unmount and remount the whole
                              subtree the instant a reply finished, which
                              re-ran every live preview from scratch. */}
                          <div>
                            <RichContent text={streaming ? hideFollowupLine(m.content) : m.content} streaming={streaming} />
                            {streaming && <span className="vx-caret" aria-hidden />}
                          </div>
                          {!busy && (
                            <div className="ai-toolbar mt-2 -ml-2 flex flex-wrap items-center gap-0.5" aria-label="Reply actions">
                              {m.engine ? (
                                <span
                                  className="inline-flex items-center rounded-md border ai-hairline px-1.5 py-[3px] mr-1 ml-2 text-[10px] font-bold ai-t3"
                                  title="Engine that answered"
                                >
                                  {m.engine}
                                </span>
                              ) : null}
                              <button
                                onClick={() => {
                                  try {
                                    void navigator.clipboard?.writeText(m.content);
                                  } catch {
                                    /* clipboard unavailable */
                                  }
                                }}
                                className="ai-tool"
                              >
                                <CopyIcon /> Copy
                              </button>
                              <button
                                onClick={() => rateReply(i, 'up')}
                                aria-label="Good response"
                                title="Good response"
                                aria-pressed={m.rating === 'up'}
                                className="ai-tool"
                              >
                                <ThumbUpIcon />
                              </button>
                              <button
                                onClick={() => rateReply(i, 'down')}
                                aria-label="Bad response"
                                title="Bad response"
                                aria-pressed={m.rating === 'down'}
                                className="ai-tool"
                              >
                                <ThumbDownIcon />
                              </button>
                              <MoreMenu actions={more} />
                            </div>
                          )}
                          {!busy && last && m.followups?.length ? (
                            <FollowupChips items={m.followups} disabled={busy} onPick={(t) => void send(t)} />
                          ) : null}
                        </>
                      ) : (
                        <span className="inline-flex items-center gap-3 ai-t2 py-2 text-sm" role="status">
                          <span className="vx-wave-loader" aria-hidden="true"><i /><i /><i /><i /><i /></span>
                          Preparing your answer
                        </span>
                      )}
                      {m.sources?.length ? (
                        // B8 — the ranked-source card: numbered to match the [1][2]
                        // citations in the answer. The colored chip is a local
                        // letter avatar, NOT a favicon fetch — pulling icons from
                        // third parties would leak what you read (privacy rule 2).
                        <div className="ai-card mt-3 px-3 py-2.5">
                          <p className="text-[10px] font-bold uppercase tracking-wider ai-t3 mb-1.5 flex items-center gap-1">
                            <GlobeIcon className="w-3 h-3" /> Sources
                          </p>
                          <div className="space-y-0.5">
                            {m.sources.map((u, k) => {
                              let host = u;
                              let path = '';
                              try {
                                const parsed = new URL(u);
                                host = parsed.hostname.replace(/^www\./, '');
                                path = parsed.pathname.length > 1 ? parsed.pathname.slice(0, 40) : '';
                              } catch {
                                /* show the raw string */
                              }
                              const hue = (host.charCodeAt(0) * 47 + host.length * 13) % 360;
                              return (
                                <a
                                  key={k}
                                  href={u}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="flex items-center gap-2 rounded-lg px-1.5 py-1 hover:bg-[var(--ai-hover)] transition-colors min-w-0"
                                >
                                  <span className="text-[10px] font-bold ai-t3 w-6 shrink-0">[{k + 1}]</span>
                                  <span
                                    aria-hidden
                                    className="w-[18px] h-[18px] rounded-md flex items-center justify-center text-[10px] font-extrabold text-white shrink-0"
                                    style={{ background: `hsl(${hue} 55% 42%)` }}
                                  >
                                    {host.charAt(0).toUpperCase()}
                                  </span>
                                  <span className="text-[11px] font-semibold ai-t2 truncate">{host}</span>
                                  {path && <span className="text-[10px] ai-t3 truncate hidden sm:inline">{path}</span>}
                                </a>
                              );
                            })}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {!isEmpty && composerBlock}
      </div>
    </div>
  );
}

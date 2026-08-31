import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { isNativePlatform } from '@/services/native';
import { buildTasteSnapshot } from '@/services/ai/taste';
import { extractRecommendedFromThread } from '@/services/ai/threadMemory';
import { searchSongs } from '@/services/api';
import { usePlayerStore } from '@/store/playerStore';
import { AuroraBackground } from '@/components/AuroraBackground';
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
import { SparkleIcon, GlobeIcon, PlusIcon, XIcon } from '@/components/Icons';
import { cn } from '@/utils/cn';
import { RichContent } from '@/components/ai/RichContent';
import { usePageMeta } from '@/hooks/usePageMeta';
import { useSettingsStore } from '@/store/settingsStore';

const ENDPOINT = isNativePlatform() ? 'https://www.sirimillavinay.online/api/vinaxai' : '/api/vinaxai';
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

type Mode = 'muse' | 'swift' | 'sage' | 'scholar' | 'win' | 'nova' | 'nano' | 'auto' | 'pro' | 'mini' | 'k3' | 'translator' | 'glimmer' | 'flash' | 'musegl' | 'ising15' | 'ising135' | 'laguna' | 'gemma4' | 'omni' | 'cgt120';
// Engine picker wears the VinaX V1 engine names (v3.0.0); ids stay stable for
// the API. All seven engines are selectable since v3.0.2.
const MODES: Array<{ id: Mode; label: string; hint: string }> = [
  // v5.6.1 — the owner's 18 live models, each under its owner-chosen name
  // (2026-08-31 key cleanup), plus AUTO and the balanced default seat.
  { id: 'auto', label: 'VinaX AUTO', hint: 'Picks the best engine for each question' },
  { id: 'muse', label: 'VinaX Balanced', hint: 'Everyday chat · recommended' },
  { id: 'win', label: 'VinaX NVD NMTRN 3.5 LTNG 30B', hint: 'Big creative engine · runs the AI DJ' },
  { id: 'sage', label: 'VinaX NVD NMTRN SUP', hint: 'Thinks deepest' },
  { id: 'nova', label: 'VinaX NVD NMTRN ULT', hint: 'Most powerful · complex questions' },
  { id: 'nano', label: 'VinaX NVD NMTRN', hint: 'Light and quick · song finder' },
  { id: 'omni', label: 'VinaX NVD NMTRN NN30B A3B', hint: 'Compact omni reasoner' },
  { id: 'pro', label: 'VinaX DP V4 PRO', hint: 'Deep analysis · advanced reasoning' },
  { id: 'flash', label: 'VinaX DP V4 FLASH', hint: 'Rapid generalist' },
  { id: 'swift', label: 'VinaX CGT 20B', hint: 'Fastest answers' },
  { id: 'cgt120', label: 'VinaX CGT 120B', hint: 'Heavyweight open engine' },
  { id: 'scholar', label: 'VinaX GRQ ALL', hint: 'Music knowledge · instant answers' },
  { id: 'mini', label: 'VinaX MIMX M3', hint: 'Dependable all-rounder' },
  { id: 'k3', label: 'VinaX K3', hint: 'Premium agent · heavyweight generalist' },
  { id: 'glimmer', label: 'VinaX DIF GEM 26B A4B IT', hint: 'Visual-creative · moods and themes' },
  { id: 'musegl', label: 'VinaX MUSE GMR 30B', hint: 'Playful creative sparks' },
  { id: 'gemma4', label: 'VinaX GEM 4 31B', hint: 'Open generalist' },
  { id: 'laguna', label: 'VinaX LGNA XS 2.1', hint: 'Small and swift' },
  { id: 'ising15', label: 'VinaX ING CALBTN 15 31B', hint: 'Rankings and comparisons' },
  { id: 'ising135', label: 'VinaX ING CALBTN 1 35B A3B', hint: 'Quick judgments' },
  { id: 'translator', label: 'VinaX TRANSLATE', hint: 'Translation specialist · 12+ languages' },
];
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
  [/minimax/i, 'VinaX MIMX M3'],
  [/kimi/i, 'VinaX K3'],
  [/diffusiongemma/i, 'VinaX DIF GEM 26B A4B IT'],
  [/muse-glimmer/i, 'VinaX MUSE GMR 30B'],
  [/gemma-4/i, 'VinaX GEM 4 31B'],
  [/laguna/i, 'VinaX LGNA XS 2.1'],
  [/ising-calibration-1\.5/i, 'VinaX ING CALBTN 15 31B'],
  [/ising-calibration-1-35b/i, 'VinaX ING CALBTN 1 35B A3B'],
  [/nano-omni/i, 'VinaX NVD NMTRN NN30B A3B'],
  // v3.7.0: openai/gpt-oss-20b now pins the chat (FLASH), fast (20B) AND dj (120B)
  // seats — NVIDIA gpt-oss-120b hung >25s and was retired. The chip reports the
  // engine that actually answered, keyed off the served slug, so a gpt-oss-20b reply
  // reads "VinaX 20B" whichever seat summoned it (the muse/win pickers still present
  // their own names — nickname != model). The gpt-oss-120b row is kept below as
  // legacy so any old meta from before the retire still labels cleanly.
  [/gpt-oss-120b/i, 'VinaX CGT 120B'],
  [/gpt-oss-20b/i, 'VinaX CGT 20B'],
  [/nemotron-super|nemotron.super/i, 'VinaX SUPER'],
  // ULTRA pins home; it also frequently COVERS the chat seat via the failover
  // ladder while the chat key is down — same honest engine-named chip either way.
  [/nemotron-3-ultra|nemotron.ultra/i, 'VinaX ULTRA'],
  // Search-lane seat (NANO 3 chat + hidden expert): the secondary pin keeps the seat's name.
  [/nemotron-3-nano|diffusiongemma|gemma/i, 'VinaX NANO 3'],
  // Chat seat's engine (FLASH): the muse pin is openai/gpt-oss-20b since v3.7.0
  // (gpt-oss-120b hung and was retired; inkling 404'd, qwen3.5 410-gone, deepseek
  // retired before it). A live gpt-oss-20b reply is chipped "VinaX 20B" above; these
  // rows only catch the retired slugs so legacy meta still reads right.
  [/inkling/i, 'VinaX FLASH'],
  [/qwen|deepseek/i, 'VinaX FLASH'],
  [/llama-3\.3-70b|llama-3\.1-8b/i, 'VinaX INSTANT'],
  [/vision|llama/i, 'VinaX VISION'],
];
const nickForModel = (model: string): string => {
  for (const [re, nick] of ENGINE_NICK) if (re.test(model)) return nick;
  return 'VinaX AI';
};

// Trending-flavoured starter pool — 4 are drawn at random per visit/new chat,
// with the listener's pinned language woven in. Never the same wall twice.
const STARTER_POOL: Array<(l: string) => string> = [
  (l) => `Suggest 5 trending ${l} songs right now`,
  (l) => `Which ${l} songs are perfect for a rainy evening?`,
  (l) => `Make me a ${l} love-songs playlist idea`,
  (l) => `What are the big ${l} movie releases this month?`,
  (l) => `Write a heartfelt birthday wish in ${l}`,
  (l) => `Translate "How are you doing?" into ${l}`,
  () => "What's trending in tech news today?",
  () => 'Latest cricket buzz — quick summary',
  () => 'Explain quantum computing simply',
  () => 'Explain AI to a 10-year-old',
  () => 'Plan a 3-day trip to Goa on a budget',
  () => 'Write an Instagram caption for a sunset photo',
  () => 'Help me write a professional leave email',
  () => '5 easy dinner recipes for tonight',
  () => 'Give me a 20-minute home workout',
  () => 'Fun facts that sound fake but are true',
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
    return saved.length ? saved : [freshChat()];
  });
  const [activeId, setActiveId] = useState<string>(() => '');
  const [input, setInput] = useState('');
  const [mode, setMode] = useState<Mode>(() => {
    try {
      const saved = localStorage.getItem('vinax.aiDefaultMode') ?? '';
      if ((['muse', 'swift', 'sage', 'scholar', 'win', 'nova', 'nano'] as string[]).includes(saved)) return saved as Mode;
      // Engine ids saved by older builds map to their closest successor.
      const legacy: Record<string, Mode> = { maverick: 'muse', diffusion: 'muse', medium: 'muse', fast: 'swift', deep: 'sage', gemma: 'scholar' };
      if (legacy[saved]) return legacy[saved];
    } catch {
      /* default */
    }
    return 'muse';
  });
  const [chatQuery, setChatQuery] = useState('');
  const [renaming, setRenaming] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [fontSize, setFontSize] = useState<'s' | 'm' | 'l'>(() => {
    try {
      return (localStorage.getItem('vinax.aiFontSize') as 's' | 'm' | 'l') ?? 'm';
    } catch {
      return 'm';
    }
  });
  const [engineOpen, setEngineOpen] = useState(false);
  const [web, setWeb] = useState(false);
  // Composer capability toggles (v2.4.0): Think routes the next messages to
  // the deep lane (high effort); Research forces multi-source web answers.
  const [think, setThink] = useState(false);
  const [research, setResearch] = useState(false);
  const [imageMode, setImageMode] = useState(false);
  const [pending, setPending] = useState<Pending[]>([]);
  const [busy, setBusy] = useState(false);
  const themePref = useSettingsStore((st) => st.theme);
  useEffect(() => {
    // Standalone route: the main layout's theme effect never runs here.
    applyThemeClasses(resolveTheme(themePref, window.matchMedia('(prefers-color-scheme: dark)').matches));
  }, [themePref]);
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
  const stateRef = useRef({ mode, web, think, research });
  stateRef.current = { mode, web, think, research };

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
  const starters = useMemo(() => {
    const raw = useSettingsStore.getState().pinnedLanguages[0] ?? 'telugu';
    const lang = raw.charAt(0).toUpperCase() + raw.slice(1);
    const pool = [...STARTER_POOL];
    const picks: string[] = [];
    while (picks.length < 4 && pool.length) {
      const i = Math.floor(Math.random() * pool.length);
      picks.push(pool.splice(i, 1)[0](lang));
    }
    return picks;
    // The chat id is a deliberate re-roll trigger: new chat = new starters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.id]);
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
    setActiveMessages((prev) => prev.slice(0, prev.lastIndexOf(lastUser)));
    void sendRef.current(lastUser.content);
  };

  const continueReply = (): void => {
    if (!busy) void sendRef.current('Continue exactly from where you stopped.');
  };

  const editPrompt = (idx: number, content: string): void => {
    if (busy) return;
    setActiveMessages((prev) => prev.slice(0, idx));
    setInput(content);
  };

  const setActiveMessages = (fn: (prev: Msg[]) => Msg[]): void => {
    setChats((prev) =>
      prev.map((c) => (c.id === (active?.id ?? '') ? { ...c, messages: fn(c.messages), updatedAt: Date.now() } : c)),
    );
  };

  const newChat = (): void => {
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

  const send = async (raw: string): Promise<void> => {
    const q = raw.trim();
    if ((!q && pending.length === 0) || busy) return;
    if (q && pending.length === 0 && (await tryMusicCommand(q))) {
      setInput('');
      return;
    }

    // 🎨 image mode: one prompt → one picture, rendered in the chat.
    if (imageMode) {
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
    const imgs = pending.filter((p) => p.kind === 'image' && p.dataUrl).map((p) => p.dataUrl as string);
    const textFiles = pending.filter((p) => p.kind === 'text' && p.text);
    let content = q;
    for (const f of textFiles) content += `\n\n--- ${f.name} ---\n${(f.text ?? '').slice(0, 6000)}`;

    setInput('');
    setPending([]);
    if (taRef.current) taRef.current.style.height = 'auto';

    const userMsg: Msg = { role: 'user', content: content || '(image)', images: imgs.length ? imgs : undefined };
    setActiveMessages((prev) => [...prev, userMsg, { role: 'assistant', content: '' }]);
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
    const apiMessages = [
      ...(voiceLive
        ? [{ role: 'user' as const, content: 'SYSTEM RULE for this voice conversation: every reply is spoken aloud — 1-3 short conversational sentences of plain text, no markdown, no lists, no emojis.' }]
        : []),
      ...(thinkNow
        ? [{ role: 'user' as const, content: 'SYSTEM RULE for this reply: reason it through privately first, then present a short structured summary of the key steps followed by a clear final answer. Raw chain-of-thought never appears in the reply.' }]
        : []),
      ...(researchNow
        ? [{ role: 'user' as const, content: 'SYSTEM RULE for this reply: research mode. Work from the web results, cross-check at least two independent sources, flag where they disagree, and tie each key fact to the source that backs it.' }]
        : []),
      ...messages,
      userMsg,
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
          // Think overrides the lane to the deep engine (VinaX SUPER · high effort) for this message.
          mode: voiceEngineRef.current ? 'voice' : thinkNow ? 'sage' : stateRef.current.mode,
          // Research always searches, and multi-source rules are prepended above.
          web: stateRef.current.web || researchNow || freshTrigger,
          images: imgs,
          // B5 — the snapshot plus this thread's own memory: everything the
          // assistant already recommended in this conversation, so "give me
          // more" turns reach into fresh territory instead of looping.
          taste: { ...buildTasteSnapshot(), alreadyRecommendedThisChat: extractRecommendedFromThread(messages) },
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
      const finalText = full.trim().replace(/\n{3,}/g, '\n\n');
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
    for (const file of Array.from(files).slice(0, 4)) {
      if (file.type.startsWith('image/')) {
        try {
          add.push({ kind: 'image', name: file.name, dataUrl: await readAsDataURL(file) });
        } catch {
          /* skip unreadable image */
        }
      } else if (file.size < 200_000) {
        try {
          add.push({ kind: 'text', name: file.name, text: await readAsText(file) });
        } catch {
          /* skip unreadable file */
        }
      }
    }
    setPending((prev) => [...prev, ...add].slice(0, 4));
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

  return (
    <div className="h-[100dvh] w-full flex text-ink-100 overflow-hidden">
      <AuroraBackground />
      {/* Sidebar */}
      <aside
        className={cn(
          'flex-col w-64 shrink-0 bg-ink-900 border-r border-glass',
          sidebarOpen ? 'flex fixed inset-y-0 left-0 z-40' : 'hidden',
          'md:flex md:static md:z-auto',
        )}
      >
        <div className="p-3">
          <button
            onClick={newChat}
            className="w-full flex items-center gap-2 px-3 py-2.5 rounded-xl btn-primary text-sm font-semibold active:scale-[.98] transition"
          >
            <PlusIcon className="w-4 h-4" /> New chat
          </button>
        </div>
        <div className="px-3 pb-2">
          <input
            value={chatQuery}
            onChange={(e) => setChatQuery(e.target.value)}
            placeholder="Search chats…"
            aria-label="Search chats"
            className="w-full px-3 py-2 rounded-xl bg-ink-800/70 text-sm outline-none placeholder:text-ink-500"
          />
        </div>
        <div className="flex-1 overflow-y-auto px-2 space-y-0.5">
          {groupChats(chats, chatQuery).map(([label, list]) => (
            <div key={label}>
              <p className="px-3 pt-3 pb-1 text-[10px] font-bold uppercase tracking-widest text-ink-500">{label}</p>
              {list.map((c) => (
                <div
                  key={c.id}
                  className={cn(
                    'group flex items-center gap-1.5 px-3 py-2 rounded-lg cursor-pointer text-sm',
                    c.id === active?.id ? 'bg-ink-800 text-ink-100' : 'text-ink-300 hover:bg-ink-800/60',
                  )}
                  onClick={() => {
                    setActiveId(c.id);
                    setSidebarOpen(false);
                  }}
                >
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
                      className="flex-1 min-w-0 bg-ink-900 rounded px-2 py-0.5 text-sm outline-none"
                    />
                  ) : (
                    <span
                      className="truncate flex-1"
                      onDoubleClick={(e) => {
                        e.stopPropagation();
                        setRenaming(c.id);
                      }}
                    >
                      {c.title}
                    </span>
                  )}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setRenaming(c.id);
                    }}
                    aria-label="Rename chat"
                    className="opacity-0 group-hover:opacity-100 text-ink-400 hover:text-ink-100 shrink-0 text-xs"
                  >
                    ✎
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      togglePin(c.id);
                    }}
                    aria-label={c.pinned ? 'Unpin chat' : 'Pin chat'}
                    className={cn(
                      'shrink-0 text-xs',
                      c.pinned ? 'text-ember-300' : 'opacity-0 group-hover:opacity-100 text-ink-400 hover:text-ink-100',
                    )}
                  >
                    ★
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteChat(c.id);
                    }}
                    aria-label="Delete chat"
                    className="opacity-0 group-hover:opacity-100 text-ink-400 hover:text-ink-100 shrink-0"
                  >
                    <TrashIcon className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          ))}
        </div>
        <div className="p-3 border-t border-glass">
          <Link to="/" className="flex items-center gap-2 text-xs text-ink-400 hover:text-ink-100 px-2 py-1.5">
            ← Back to VinaX
          </Link>
        </div>
      </aside>

      {sidebarOpen && <button aria-label="Close menu" className="fixed inset-0 z-30 bg-black/50 md:hidden" onClick={() => setSidebarOpen(false)} />}
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
        <header className="flex items-center gap-2 px-4 py-3 border-b border-glass shrink-0">
          <button className="md:hidden p-1.5 text-ink-300" aria-label="Menu" onClick={() => setSidebarOpen(true)}>
            <MenuIcon className="w-6 h-6" />
          </button>
          <span className="w-8 h-8 rounded-xl bg-ai-accent text-white flex items-center justify-center shrink-0">
            <SparkleIcon className="w-5 h-5" />
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="text-sm font-bold leading-tight ai-title w-fit">VinaX AI</h1>
            <p className="text-[11px] text-ink-400 leading-tight">Ask anything · nothing you type is stored on our servers</p>
          </div>
          <div className="relative">
            <button
              onClick={() => {
                setExportOpen((v) => !v);
                setSettingsOpen(false);
              }}
              aria-label="Export chat"
              title="Export chat"
              className="p-1.5 text-ink-300 hover:text-ink-100 text-base leading-none"
            >
              ⤓
            </button>
            {exportOpen && (
              <div className="absolute right-0 top-full mt-1 z-50 w-44 rounded-xl bg-[color:var(--surface-modal)] border border-glass-strong shadow-2xl py-1">
                {(['txt', 'md', 'pdf'] as const).map((k) => (
                  <button
                    key={k}
                    onClick={() => {
                      exportChat(k);
                      setExportOpen(false);
                    }}
                    className="w-full text-left px-3 py-2 text-xs hover:bg-ink-800/60"
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
              }}
              aria-label="Chat settings"
              title="Chat settings"
              className="p-1.5 text-ink-300 hover:text-ink-100 text-base leading-none"
            >
              ⚙
            </button>
            {settingsOpen && (
              <div className="absolute right-0 top-full mt-1 z-50 w-64 rounded-2xl bg-[color:var(--surface-modal)] border border-glass-strong shadow-2xl p-3 space-y-3 text-left">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-ink-400 mb-1">Default engine</p>
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
                    className="w-full px-2.5 py-2 rounded-lg bg-ink-800/70 text-xs outline-none"
                  >
                    {MODES.map((mm) => (
                      <option key={mm.id} value={mm.id}>
                        {mm.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-ink-400 mb-1">Text size</p>
                  <div className="flex gap-1.5">
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
                        className={cn(
                          'px-3 py-1.5 rounded-lg text-xs font-bold',
                          fontSize === f ? 'bg-ai-accent text-white' : 'bg-ink-800/70 text-ink-300',
                        )}
                      >
                        {f.toUpperCase()}
                      </button>
                    ))}
                  </div>
                </div>
                <button onClick={exportAll} className="w-full px-3 py-2 rounded-lg bg-ink-800/70 text-xs text-left hover:bg-ink-700">
                  Export all chats (.json)
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
                  className="w-full px-3 py-2 rounded-lg bg-ink-800/70 text-xs text-left text-red-300 hover:bg-ink-700"
                >
                  Clear all chats
                </button>
              </div>
            )}
          </div>
          <Link to="/" className="hidden md:inline text-xs text-ink-400 hover:text-ink-100">
            ← VinaX
          </Link>
        </header>

        {/* Messages */}
        <div
          ref={listRef}
          className={cn('flex-1 overflow-y-auto ai-ambient', fontSize === 's' ? 'text-[13px]' : fontSize === 'l' ? 'text-[17px]' : '')}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            void onFiles(e.dataTransfer.files);
          }}
        >
          {messages.length === 0 ? (
            <div className="min-h-full flex flex-col items-center justify-center px-5 py-10 text-center">
              <span className="w-16 h-16 rounded-2xl bg-ai-accent text-white flex items-center justify-center mb-5">
                <SparkleIcon className="w-8 h-8" />
              </span>
              <h2 className="text-2xl font-bold mb-2">
                {(() => {
                  const h = new Date().getHours();
                  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
                })()}{' '}
                — ask me anything
              </h2>
              <p className="text-sm text-ink-300 mb-7 max-w-md">
                Music, writing, code, translations, current events — seven engines (VinaX FLASH, 20B, SUPER, INSTANT, 120B, ULTRA and NANO 3), live web search and voice chat.
              </p>
              <div className="grid sm:grid-cols-2 gap-2.5 w-full max-w-xl">
                {starters.map((s) => (
                  <button
                    key={s}
                    onClick={() => void send(s)}
                    className="px-4 py-3 rounded-xl text-sm text-left bg-ink-800/70 text-ink-200 border border-glass hover:bg-ink-700 hover:text-ink-100 hover:border-ember-500/40 transition"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="mx-auto w-full max-w-3xl px-4 py-6 space-y-5">
              {messages.map((m, i) => (
                <div key={i} className={cn('flex gap-3 animate-fade-up', m.role === 'user' ? 'justify-end' : 'justify-start')}>
                  {m.role === 'assistant' && (
                    <span
                      className={cn(
                        'w-7 h-7 rounded-lg bg-ai-accent text-white flex items-center justify-center shrink-0 mt-0.5',
                        busy && i === messages.length - 1 && 'motion-safe:animate-[avatar-pulse_1.6s_ease-in-out_infinite]',
                      )}
                    >
                      <SparkleIcon className="w-4 h-4" />
                    </span>
                  )}
                  <div
                    className={cn(
                      'max-w-[85%] text-sm',
                      m.role === 'user' ? 'btn-primary rounded-2xl rounded-br-md px-4 py-2.5' : 'glass-card ai-bubble rounded-2xl rounded-bl-md px-4 py-3',
                    )}
                    onDoubleClick={m.role === 'user' ? () => editPrompt(i, m.content) : undefined}
                    title={m.role === 'user' ? 'Double-tap to edit & resend' : undefined}
                  >
                    {m.images?.length ? (
                      <div className="flex flex-wrap gap-2 mb-2">
                        {m.images.map((src, k) => (
                          <img key={k} src={src} alt="attachment" className="w-24 h-24 object-cover rounded-lg" />
                        ))}
                      </div>
                    ) : null}
                    {m.role === 'assistant' && m.player ? (
                      <ChatPlayerCard fallback={m.content} />
                    ) : m.role === 'assistant' ? (
                      m.content ? (
                        <>
                          {busy && i === messages.length - 1 ? (
                            /* v5.6.0 — markdown renders LIVE while streaming
                               (headings, bold, lists, code, tables), exactly
                               like ChatGPT/Gemini; RichContent streams safely
                               (an unclosed fence shows as preformatted text
                               until it completes). */
                            <div>
                              <RichContent text={m.content} />
                              <span className="vx-caret" aria-hidden />
                            </div>
                          ) : (
                            <RichContent text={m.content} />
                          )}
                          {!busy && (
                            <div className="mt-2 flex items-center gap-3 text-[11px] text-ink-400">
                              {m.engine ? (
                                <span
                                  className="px-2 py-px rounded-full bg-ink-800/50 text-[10px] font-medium text-ink-400"
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
                                className="hover:text-ink-100"
                              >
                                Copy
                              </button>
                              <button
                                onClick={() => rateReply(i, 'up')}
                                aria-label="Good response"
                                aria-pressed={m.rating === 'up'}
                                className={cn('hover:text-ink-100', m.rating === 'up' && 'text-ember-400')}
                              >
                                👍
                              </button>
                              <button
                                onClick={() => rateReply(i, 'down')}
                                aria-label="Bad response"
                                aria-pressed={m.rating === 'down'}
                                className={cn('hover:text-ink-100', m.rating === 'down' && 'text-ember-400')}
                              >
                                👎
                              </button>
                              {i === messages.length - 1 && (
                                <>
                                  <button onClick={regenerate} className="hover:text-ink-100">
                                    Regenerate
                                  </button>
                                  <button onClick={continueReply} className="hover:text-ink-100">
                                    Continue
                                  </button>
                                </>
                              )}
                            </div>
                          )}
                        </>
                      ) : (
                        <span className="vx-dots inline-flex items-center gap-1 text-ink-300" role="status" aria-label="Thinking">
                          <i />
                          <i />
                          <i />
                        </span>
                      )
                    ) : (
                      <>
                        <p className="whitespace-pre-wrap leading-relaxed">{m.content}</p>
                        {!busy && (
                          <button
                            onClick={() => editPrompt(i, m.content)}
                            className="mt-1 block text-[11px] text-white/70 hover:text-white"
                          >
                            Edit
                          </button>
                        )}
                      </>
                    )}
                    {m.sources?.length ? (
                      // B8 — the ranked-source card: numbered to match the [1][2]
                      // citations in the answer. The colored chip is a local
                      // letter avatar, NOT a favicon fetch — pulling icons from
                      // third parties would leak what you read (privacy rule 2).
                      <div className="mt-2.5 pt-2.5 border-t border-glass-strong">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-ink-500 mb-1.5 flex items-center gap-1">
                          <GlobeIcon className="w-3 h-3" /> Sources
                        </p>
                        <div className="space-y-1">
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
                                className="flex items-center gap-2 rounded-lg px-1.5 py-1 hover:bg-ink-800/70 transition-colors min-w-0"
                              >
                                <span className="text-[10px] font-bold text-ink-500 w-6 shrink-0">[{k + 1}]</span>
                                <span
                                  aria-hidden
                                  className="w-[18px] h-[18px] rounded-md flex items-center justify-center text-[10px] font-extrabold text-white shrink-0"
                                  style={{ background: `hsl(${hue} 55% 42%)` }}
                                >
                                  {host.charAt(0).toUpperCase()}
                                </span>
                                <span className="text-[11px] font-semibold text-ink-200 truncate">{host}</span>
                                {path && <span className="text-[10px] text-ink-500 truncate hidden sm:inline">{path}</span>}
                              </a>
                            );
                          })}
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Composer */}
        <div className="shrink-0 border-t border-glass px-3 sm:px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <div className="mx-auto w-full max-w-3xl">
            {pending.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-2">
                {pending.map((p, i) => (
                  <span key={i} className="flex items-center gap-1.5 text-xs bg-ink-800 rounded-lg pl-2 pr-1 py-1 text-ink-200">
                    {p.kind === 'image' && p.dataUrl ? (
                      <img src={p.dataUrl} alt="" className="w-6 h-6 rounded object-cover" />
                    ) : null}
                    <span className="max-w-[10rem] truncate">{p.name}</span>
                    <button
                      aria-label="Remove"
                      onClick={() => setPending((prev) => prev.filter((_, k) => k !== i))}
                      className="text-ink-400 hover:text-ink-100"
                    >
                      <XIcon className="w-3.5 h-3.5" />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div className="flex items-end gap-2 glass-input rounded-2xl px-2.5 py-2">
              <input
                ref={fileRef}
                type="file"
                multiple
                accept="image/*,.txt,.md,.csv,.json,.log"
                className="hidden"
                onChange={(e) => void onFiles(e.target.files)}
              />
              <button
                onClick={() => fileRef.current?.click()}
                aria-label="Add photos or files"
                className="p-2 rounded-full text-ink-300 hover:text-ink-100 hover:bg-ink-800/60 shrink-0"
                title="Add photos & files"
              >
                <PlusIcon className="w-5 h-5" />
              </button>
              <button
                onClick={() => setWeb((v) => !v)}
                aria-pressed={web}
                title="Web search"
                className={cn(
                  'p-2 rounded-full shrink-0 transition',
                  web ? 'text-ember-400 bg-ember-500/15' : 'text-ink-300 hover:text-ink-100 hover:bg-ink-800/60',
                )}
              >
                <GlobeIcon className="w-5 h-5" />
              </button>
              {IMAGES_ENABLED && (
              <button
                onClick={() => setImageMode((v) => !v)}
                aria-pressed={imageMode}
                aria-label="Create an image"
                title="Create an image from your next message"
                className={cn(
                  'p-2 rounded-full shrink-0 transition text-base leading-none',
                  imageMode ? 'bg-ember-500/20 ring-1 ring-ember-400/50' : 'hover:bg-ink-800/60',
                )}
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
                  className={cn(
                    'p-2 rounded-full shrink-0 transition',
                    voiceMode ? 'text-ember-400 bg-ember-500/15' : 'text-ink-300 hover:text-ink-100 hover:bg-ink-800/60',
                  )}
                >
                  <WaveformIcon className="w-5 h-5" />
                </button>
              )}
              <textarea
                ref={taRef}
                value={input}
                onChange={(e) => {
                  setInput(e.target.value);
                  const t = e.target;
                  t.style.height = 'auto';
                  t.style.height = `${Math.min(t.scrollHeight, 180)}px`;
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    void send(input);
                  }
                }}
                rows={1}
                placeholder={imageMode ? 'Describe the image to create…' : listening ? 'Listening…' : 'Message VinaX AI…'}
                aria-label="Message VinaX AI"
                className="flex-1 bg-transparent resize-none outline-none text-sm py-1.5 max-h-44 leading-relaxed"
              />
              {canSpeech && (
                <button
                  onClick={() => (listening ? stopListening() : startListening(false))}
                  aria-label="Voice input"
                  title="Speak"
                  className={cn(
                    'p-2 rounded-full shrink-0 transition',
                    listening ? 'text-white bg-ember-500 animate-pulse' : 'text-ink-300 hover:text-ink-100 hover:bg-ink-800/60',
                  )}
                >
                  <MicIcon className="w-5 h-5" />
                </button>
              )}
              {busy ? (
                <button onClick={stop} aria-label="Stop" className="p-2 rounded-full bg-ink-700 text-ink-100 shrink-0">
                  <StopIcon className="w-5 h-5" />
                </button>
              ) : (
                <button
                  onClick={() => void send(input)}
                  disabled={!input.trim() && pending.length === 0}
                  aria-label="Send"
                  className="p-2 rounded-full btn-primary shrink-0 disabled:opacity-40 active:scale-95 transition"
                >
                  <SendIcon className="w-5 h-5" />
                </button>
              )}
            </div>

            {/* mode + capability-toggle row */}
            <div className="flex items-center justify-between gap-2 mt-2 px-1">
              <div className="flex items-center gap-1.5 min-w-0">
              <div className="relative">
                <button
                  onClick={() => setEngineOpen((v) => !v)}
                  aria-haspopup="listbox"
                  aria-expanded={engineOpen}
                  className="flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-ink-800/60 text-xs font-semibold text-ink-200 hover:text-ink-100 hover:bg-ink-800 transition"
                >
                  <span className="font-mono">{MODES.find((mm) => mm.id === mode)?.label}</span>
                  <span className="text-ink-400" aria-hidden>
                    ▾
                  </span>
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
                      className="absolute bottom-full mb-2 left-0 z-50 w-64 max-h-[min(60vh,480px)] overflow-y-auto overscroll-contain rounded-2xl bg-[color:var(--surface-modal)] backdrop-blur-xl border border-[color:var(--glass-border)] shadow-2xl py-1.5 animate-fade-up"
                    >
                      {MODES.map((mm) => (
                        <button
                          key={mm.id}
                          role="option"
                          aria-selected={mode === mm.id}
                          onClick={() => {
                            setMode(mm.id);
                            setEngineOpen(false);
                          }}
                          className={cn(
                            'w-full flex items-center justify-between gap-3 px-3.5 py-2.5 text-left hover:bg-ink-800/60 transition-colors',
                            mode === mm.id ? 'text-ember-300' : 'text-ink-100',
                          )}
                        >
                          <span className="min-w-0">
                            <span className="block font-mono text-[13px] truncate">{mm.label}</span>
                            <span className="block text-[11px] text-ink-400">{mm.hint}</span>
                          </span>
                          {mode === mm.id && <span aria-hidden>✓</span>}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
              <button
                onClick={() => setThink((v) => !v)}
                aria-pressed={think}
                title="Think — send the next message to the deep engine for careful reasoning"
                className={cn(
                  'px-3 py-1.5 rounded-full text-[11px] font-bold shrink-0 transition',
                  think
                    ? 'text-ember-400 bg-ember-500/15 ring-1 ring-ember-400/40'
                    : 'text-ink-300 hover:text-ink-100 bg-ink-800/60 hover:bg-ink-800',
                )}
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
                className={cn(
                  'px-3 py-1.5 rounded-full text-[11px] font-bold shrink-0 transition',
                  research
                    ? 'text-ember-400 bg-ember-500/15 ring-1 ring-ember-400/40'
                    : 'text-ink-300 hover:text-ink-100 bg-ink-800/60 hover:bg-ink-800',
                )}
              >
                Research
              </button>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {micNote ? (
                  <span className="text-[11px] text-amber-500 dark:text-amber-400" role="status">
                    {micNote}
                  </span>
                ) : busy && think ? (
                  <span className="text-[11px] text-ember-400" role="status">
                    thinking deeply…
                  </span>
                ) : web ? (
                  <span className="text-[11px] text-ember-400">{research ? 'Research on' : 'Web search on'}</span>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

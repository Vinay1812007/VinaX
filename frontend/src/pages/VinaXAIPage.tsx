import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from 'react';
import '@/styles/ai.css';
import '@/styles/ai-styles.css';
import { ChevronDownIcon, DownloadIcon, PlusIcon, SettingsIcon } from '@/components/Icons';
import { Toasts } from '@/components/Toasts';
import { SavedPromptsSheet } from '@/components/ai/AiExtras';
import { droppedFiles, foldAttachments, type Attachment } from '@/features/ai/attachments';
import { splitFollowups } from '@/features/ai/followups';
import { onSpeakingChange, readAloud, readAloudSupported, setReadAloudVoice } from '@/features/ai/readAloud';
import { parseSlash } from '@/features/ai/slashCommands';
import { Composer, type ComposerHandle } from '@/features/ai/chat/Composer';
import { Greeting, Suggestions, type QuickAction } from '@/features/ai/chat/EmptyState';
import { LiveVoiceHost } from '@/features/ai/chat/LiveVoiceHost';
import { MessageList, followAfterScroll } from '@/features/ai/chat/MessageList';
import type { MessageHandlers } from '@/features/ai/chat/Message';
import { ChatStyleContext, useChatStyle } from '@/features/ai/chat/ChatStyleScope';
import { layoutAttrs } from '@/features/ai/chat/chatStyle';
import { ModelMenu } from '@/features/ai/chat/ModelMenu';
import { SettingsDialog } from '@/features/ai/chat/SettingsDialog';
import { CreateBar } from '@/features/ai/chat/CreateBar';
import { createMedia, loadMediaPick, resolveMediaPick, saveMediaPick, type CreateKind } from '@/features/ai/chat/media';
import { EMPTY_VOICES, parseVoiceCatalog, type VoiceCatalog } from '@/features/ai/chat/voices';
import { codeConnectorOn, type CodeSupport } from '@/features/ai/connectors';
import { DEVICE_VOICE, migrateVoicePick, parseVoicePick } from '@/features/ai/voicePick';
import { Sidebar, type SidebarHandlers } from '@/features/ai/chat/Sidebar';
import { Toast, type ToastState } from '@/features/ai/chat/Toast';
import { buildChatRequest } from '@/features/ai/chat/buildChatRequest';
import { CHAT_ENDPOINT, VOICES_ENDPOINT, clientHeaders } from '@/features/ai/chat/endpoints';
import { FileIcon, MenuIcon, PanelIcon } from '@/features/ai/chat/icons';
import { collectArtifacts } from '@/features/ai/artifacts/collect';
import {
  CODE_TOOL,
  canRunCode,
  choiceLabel,
  choiceProvider,
  isProviderId,
  mediaGroups,
  loadDefaultChoice,
  loadInitialChoice,
  loadRecents,
  pushRecent,
  saveDefaultChoice,
  saveLastChoice,
  forgetChoice,
  AUTO,
  saveRecents,
} from '@/features/ai/chat/models';
import { tryMusicCommand } from '@/features/ai/chat/musicCommands';
import { QUICK_ACTIONS, drawStarters } from '@/features/ai/chat/starters';
import { placeMenu, type MenuPlacement } from '@/features/ai/chat/placeMenu';
import {
  PREF,
  dropRetiredPrefs,
  exportAllChats,
  exportChat,
  freshChat,
  importChats,
  loadInitialChats,
  persistChats,
  readFlag,
  readPref,
  writeFlag,
  writePref,
  titleFromMessage,
} from '@/features/ai/chat/storage';
import { canRetry, failureMessage, needsEdit, pickIssueMessage, runChatStream, type ChatStreamResult } from '@/features/ai/chat/streamClient';
import { initialStreamState } from '@/features/ai/chat/streamReducer';
import type { Conversation, MediaPick, ModelChoice, Msg } from '@/features/ai/chat/types';
import { useModelCatalog } from '@/features/ai/chat/useModelCatalog';
import { useLiveVoice } from '@/features/ai/chat/useLiveVoice';
import { useStableHandlers } from '@/features/ai/chat/useStableHandlers';
import { useClientConfig } from '@/features/home/useAppConfig';
import { probeSttSupport, sttSupported } from '@/features/voice/stt';
import { usePageMeta } from '@/hooks/usePageMeta';
import { generatePlaylist } from '@/services/ai/playlist';
const ArtifactPanel = lazy(() => import('@/features/ai/artifacts/ArtifactPanel').then((m) => ({ default: m.ArtifactPanel })));
const ProjectSheet = lazy(() => import('@/features/ai/chat/ProjectSheet').then((m) => ({ default: m.ProjectSheet })));
import { usePlayerStore } from '@/store/playerStore';
import { useSettingsStore } from '@/store/settingsStore';
import { cn } from '@/utils/cn';
import { scrollBehavior } from '@/utils/motion';
import { applyThemeClasses, resolveTheme } from '@/utils/theme';

/**
 * v7.1 — the VinaX AI chat surface.
 *
 * This module is the conductor and nothing else: it owns the conversations,
 * the chosen model and the turn in flight, and hands everything visible to
 * focused pieces under features/ai/chat — Sidebar, MessageList / Message,
 * Composer, ModelMenu, SettingsDialog — with the stream parsing in a pure
 * reducer (streamReducer.ts) behind a small network client (streamClient.ts).
 *
 * Nothing here subscribes to anything that ticks: the text being typed lives
 * in the composer, live-voice captions in their own store, and the player is
 * read at the moment a message is sent.
 */

type FontSize = 's' | 'm' | 'l';
const readFontSize = (): FontSize => {
  const v = readPref(PREF.fontSize, 'm');
  return v === 's' || v === 'l' ? v : 'm';
};

/** 11.0 — a fresh id for each turn (unique across reloads, so a stored tag
 *  can never match a later turn). */
let turnCount = 0;
const nextTurnNumber = (): number => {
  turnCount += 1;
  return turnCount;
};

export default function VinaXAIPage(): ReactNode {
  /* ---------- conversations ---------- */
  const [chats, setChats] = useState<Conversation[]>(loadInitialChats);
  const [activeId, setActiveId] = useState<string>(() => '');
  const active = useMemo(() => chats.find((c) => c.id === activeId) ?? chats[0], [chats, activeId]);
  const messages = active?.messages ?? [];
  // 9.1.0 — how many artifacts this chat holds, for the header toggle. Keyed on a
  // cheap fingerprint (message count + the last message's length) so a streamed
  // reply re-scans the thread once per chunk rather than per character.
  const threadStamp = `${messages.length}:${messages[messages.length - 1]?.content.length ?? 0}`;
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the stamp IS the dependency
  const artifactCount = useMemo(() => collectArtifacts(messages).length, [threadStamp]);
  const isEmpty = messages.length === 0;
  const [busy, setBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  /* ---------- model ---------- */
  const [choice, setChoice] = useState<ModelChoice>(loadInitialChoice);
  const [defaultChoice, setDefaultChoice] = useState<ModelChoice | null>(loadDefaultChoice);
  const [recents, setRecents] = useState<ModelChoice[]>(loadRecents);
  const [menuOpen, setMenuOpen] = useState(false);
  const catalog = useModelCatalog();

  // 10.2 — clear preference keys no build reads any more ("Start in Agent mode").
  useEffect(dropRetiredPrefs, []);

  /* ---------- composer toggles ---------- */
  // Think routes the next messages to the deep lane.
  const [think, setThink] = useState(false);
  // 10.3 — Create image / Create music clip: the next messages describe what
  // to make, until the bar's × turns it off. The model for each kind is the
  // last one used while the server still lists it, else the first listed.
  const [createKind, setCreateKind] = useState<CreateKind | null>(null);
  const [createPicks, setCreatePicks] = useState<Record<CreateKind, MediaPick | null>>(() => ({
    image: loadMediaPick('image'),
    music: loadMediaPick('music'),
  }));
  // 10.3 — the composer mic's engine (Settings → Voice → Dictation).
  const [dictationPick, setDictationPick] = useState<MediaPick | null>(() => loadMediaPick('transcription'));

  /* ---------- preferences (each on its long-standing key) ---------- */
  const [profile, setProfile] = useState(() => readPref(PREF.profile, ''));
  const [fontSize, setFontSize] = useState<FontSize>(readFontSize);
  const [replyLang, setReplyLang] = useState(() => readPref(PREF.replyLang, 'auto'));
  const [replyStyle, setReplyStyle] = useState(() => readPref(PREF.replyStyle, 'auto'));
  const [songCtx, setSongCtx] = useState(false);
  const [sendOnEnter, setSendOnEnter] = useState(() => readFlag(PREF.sendOnEnter, true));
  const [autoRead, setAutoRead] = useState(() => readFlag(PREF.autoRead, false));
  // Voice: `${provider}|${model}|${voice}`, or DEVICE_VOICE ('device' = the
  // browser's own speech engine — always available, works offline). One
  // string, so a half-set preference is impossible. 10.3 — an older build's
  // `${model}|${persona}` is rewritten once with its provider (voicePick.ts),
  // so a listener keeps the voice they had.
  const [voicePick, setVoicePick] = useState(() => {
    const raw = readPref(PREF.voice, DEVICE_VOICE) || DEVICE_VOICE;
    const next = migrateVoicePick(raw);
    if (next !== raw) writePref(PREF.voice, next);
    return next;
  });
  const [voiceCatalog, setVoiceCatalog] = useState<VoiceCatalog | null>(null);
  const userName = useMemo(() => {
    try {
      return (JSON.parse(localStorage.getItem(PREF.userName) ?? '""') as string) || '';
    } catch {
      return '';
    }
  }, []);

  /* ---------- page furniture: dialogs, menus, sidebar, toast ---------- */
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [promptsDraft, setPromptsDraft] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => readFlag(PREF.sidebarCollapsed, false));
  const [toast, setToast] = useState<ToastState | null>(null);
  // 9.1.0 — the artifact panel (documents, pages and code this chat produced).
  const [artifactsOpen, setArtifactsOpen] = useState(false);
  const [projectsOpen, setProjectsOpen] = useState(false);
  /** The message list's own "jump to message i", published on mount. */
  const jumpToMessage = useRef<((index: number) => void) | null>(null);
  const [dropActive, setDropActive] = useState(false);
  const [speakingId, setSpeakingId] = useState<string | null>(null);

  const composerRef = useRef<ComposerHandle>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const toastSeq = useRef(0);
  const showToast = useCallback((message: string, undo?: () => void): void => {
    toastSeq.current += 1;
    setToast({ id: toastSeq.current, message, undo });
  }, []);
  const clearToast = useCallback(() => setToast(null), []);

  useEffect(() => onSpeakingChange(setSpeakingId), []);

  const themePref = useSettingsStore((st) => st.theme);
  useEffect(() => {
    // Standalone route: the main layout's theme effect never runs here.
    applyThemeClasses(resolveTheme(themePref, window.matchMedia('(prefers-color-scheme: dark)').matches));
  }, [themePref]);
  // No deterrence on the AI page: text selects, images drag, right-click
  // opens the browser menu (the document listeners in utils/deterrence.ts
  // exempt this route; the class carries the CSS side).
  useEffect(() => {
    const root = document.documentElement;
    const had = root.classList.contains('deter');
    root.classList.remove('deter');
    return () => {
      if (had) root.classList.add('deter');
    };
  }, []);

  useEffect(() => {
    if (!activeId) setActiveId(chats[0]?.id ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Debounced persist: every streamed chunk bumps `chats`, so writing on each
  // update would thrash storage. One write per 500ms of quiet, and a forced
  // flush on tab hide so nothing is lost.
  useEffect(() => {
    const t = setTimeout(() => persistChats(chats), 500);
    return () => clearTimeout(t);
  }, [chats]);
  // 11.0 — leaving the page inside those 500ms used to drop the last write
  // (the timer is cancelled on unmount): flush what is on screen on the way out.
  const chatsRef = useRef(chats);
  chatsRef.current = chats;
  useEffect(() => () => persistChats(chatsRef.current), []);
  useEffect(() => {
    const onHide = (): void => persistChats(chats);
    window.addEventListener('pagehide', onHide);
    return () => window.removeEventListener('pagehide', onHide);
  }, [chats]);
  // Follow the newest reply, but ONLY while the reader is at the bottom —
  // never yank someone back down while they re-read an earlier reply.
  // 9.0 — "at the bottom" is what the reader's last scroll left it at, not a
  // measurement taken after the reply grew (a large chunk, or song rows
  // resolving, used to push the thread past the threshold and stop the
  // follow); a reader who scrolled up gets a "Jump to latest" pill instead.
  // Instant on purpose (an 'auto' scroll is never motion): a smooth scroll
  // per streamed chunk lags behind a growing reply.
  const [atBottom, setAtBottom] = useState(true);
  const stickRef = useRef(true);
  /** A smooth "Jump to latest" is under way: its own scroll events must not
   *  bring the pill straight back. */
  const jumpingRef = useRef(false);
  /** Where the last scroll event left the thread — tells a reader scrolling
   *  up from a thread that grew under them. */
  const lastTopRef = useRef(0);
  const measureBottom = useCallback((): void => {
    const list = listRef.current;
    if (!list) return;
    // 11.0 — the thread growing under a pinned reader is not the reader
    // leaving the bottom (see followAfterScroll).
    const follow = followAfterScroll({
      top: list.scrollTop,
      lastTop: lastTopRef.current,
      height: list.scrollHeight,
      client: list.clientHeight,
      pinned: stickRef.current,
    });
    lastTopRef.current = list.scrollTop;
    if (jumpingRef.current && !follow.pinned) return;
    jumpingRef.current = false;
    stickRef.current = follow.pinned;
    setAtBottom(follow.pinned);
    if (follow.rescroll) list.scrollTo({ top: list.scrollHeight, behavior: 'auto' });
  }, []);
  useEffect(() => {
    const list = listRef.current;
    if (list && stickRef.current) list.scrollTo({ top: list.scrollHeight, behavior: 'auto' });
  }, [chats]);
  // Opening a chat shows its latest message.
  useEffect(() => {
    const list = listRef.current;
    stickRef.current = true;
    setAtBottom(true);
    list?.scrollTo({ top: list.scrollHeight, behavior: 'auto' });
  }, [activeId]);
  // The thread also grows without a new chunk (song rows resolving, a diagram
  // or picture loading): keep a reader who is at the bottom there.
  useEffect(() => {
    const list = listRef.current;
    const content = list?.firstElementChild;
    if (!list || !content || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      if (stickRef.current) list.scrollTo({ top: list.scrollHeight, behavior: 'auto' });
    });
    ro.observe(content);
    return () => ro.disconnect();
  }, [activeId, isEmpty]);

  // Browser tab mirrors the open conversation.
  const chatTitle = active && active.messages.length && active.title !== 'New chat' ? active.title : null;
  usePageMeta({
    title: chatTitle ?? 'VinaX AI — ask anything',
    description:
      'Chat with VinaX AI — ask anything and get clean answers with code, tables and images. Free, private, no login.',
    canonicalPath: '/VinaXAI',
  });

  // The console can add starters (Admin → AI Starter Prompts) and replace the
  // quick-action chips (Admin → AI Quick Actions).
  const clientCfg = useClientConfig();
  const quickActions = useMemo<QuickAction[]>(() => (clientCfg?.aiQuick.length ? clientCfg.aiQuick : QUICK_ACTIONS), [clientCfg]);
  const starters = useMemo(
    () => drawStarters(useSettingsStore.getState().pinnedLanguages[0] ?? 'telugu', clientCfg?.aiStarters ?? []),
    // The chat id is a deliberate re-roll trigger: new chat = new starters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [active?.id, clientCfg],
  );

  /* ---------- latest values for callbacks that outlive a render ---------- */
  const stateRef = useRef({ choice, think, profile, replyLang, replyStyle, songCtx, autoRead });
  stateRef.current = { choice, think, profile, replyLang, replyStyle, songCtx, autoRead };

  /* ---------- model selection ---------- */
  const applyChoice = useCallback((c: ModelChoice): void => {
    setChoice(c);
    saveLastChoice(c);
    setRecents((prev) => {
      const list = pushRecent(prev, c);
      saveRecents(list);
      return list;
    });
  }, []);

  const pickModel = (next: ModelChoice): void => {
    applyChoice(next);
    setMenuOpen(false);
    composerRef.current?.focus();
  };

  const [menuPlace, setMenuPlace] = useState<MenuPlacement | null>(null);
  const toggleMenu = (anchor: DOMRect): void => {
    setMenuPlace(placeMenu(anchor, { width: window.innerWidth, height: window.innerHeight }));
    setMenuOpen((v) => !v);
    // The catalogue is fetched when the menu is first opened, never on page
    // load — a listener who stays on Auto pays nothing for it.
    void catalog.load();
  };

  // The menu is placed against the viewport; a resize or rotation closes it
  // rather than leaving it stranded.
  useEffect(() => {
    if (!menuOpen) return;
    const close = (): void => setMenuOpen(false);
    window.addEventListener('resize', close);
    return () => window.removeEventListener('resize', close);
  }, [menuOpen]);

  // 10.3 — the chip reads the model's original name (live once the list is
  // known, else the name saved with the pick) beside its provider's logo.
  const modelLabel = choiceLabel(choice, catalog.providers);
  const chatStyle = useChatStyle(choice, catalog.providers);
  const modelProvider = choiceProvider(choice);
  // 10.3 — can the model in use run code? Nothing is claimed before the list is read.
  const codeSupport: CodeSupport =
    catalog.state !== 'ready'
      ? 'unknown'
      : choice.mode === 'auto'
        ? 'auto'
        : canRunCode(catalog.providers, choice.provider, choice.model)
          ? 'ok'
          : 'unsupported';
  const codeSupportRef = useRef(codeSupport);
  codeSupportRef.current = codeSupport;
  const featuresRef = useRef(catalog.features);
  featuresRef.current = catalog.features;
  // 10.3 — Run code left on from an earlier visit: read the list once, so the
  // connector is shown (or not) and the request knows whether to ask for it.
  useEffect(() => {
    if (codeConnectorOn()) void catalog.load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on arrival
  }, []);

  /* ---------- voice ---------- */
  // The engine reads this on every spoken chunk, so changing the voice in
  // Settings takes effect on the next sentence, not the next session.
  const voicePickRef = useRef(voicePick);
  voicePickRef.current = voicePick;
  /** What the voice route should use for the next chunk: null means speak on
   *  this device, which is also the answer when no speech model is served. */
  const serverVoice = useCallback((): { provider: string; model: string; voice: string } | null => parseVoicePick(voicePickRef.current), []);
  // Read aloud speaks through the same chosen voice as live chat.
  useEffect(() => {
    setReadAloudVoice(serverVoice);
    return () => setReadAloudVoice(null);
  }, [serverVoice]);

  /** Ask the server which speech models the key actually serves. Loaded when
   *  Settings first opens, so a listener who never opens it pays nothing. An
   *  empty answer is shown as such — never a guessed voice. */
  const voicesAsked = useRef(false);
  const loadVoices = useCallback(() => {
    if (voicesAsked.current) return;
    voicesAsked.current = true;
    // 10.3 — every speech model's voices, grouped by provider (voices.ts reads
    // an older server's one-provider answer too).
    void fetch(VOICES_ENDPOINT)
      .then((r) => (r.ok ? (r.json() as Promise<unknown>) : Promise.reject(new Error('bad response'))))
      .then((j) => setVoiceCatalog(parseVoiceCatalog(j)))
      .catch(() => setVoiceCatalog(EMPTY_VOICES));
  }, []);

  // The live voice chat: engine, overlay state and waveform live in the hook;
  // the page only needs to know whether one is running and to feed it text.
  const stopRef = useRef<() => void>(() => undefined);
  const voice = useLiveVoice({
    getServerVoice: serverVoice,
    onUserFinal: (text) => {
      // 11.0 — speaking over a reply that is still arriving ends that reply
      // first; the new utterance used to be dropped while the turn was busy.
      if (turnRef.current) stopRef.current();
      void sendRef.current(text);
    },
    onStopReply: () => stopRef.current(),
  });
  const voiceEngineRef = voice.engineRef;
  const voiceMode = voice.active;

  // Voice everywhere: the web uses the browser's speech API; the app uses the
  // system recognizer via the native plugin. The async probe refines the
  // native answer once the device confirms a recognition service exists.
  const [canSpeech, setCanSpeech] = useState<boolean>(() => sttSupported());
  useEffect(() => {
    void probeSttSupport().then(setCanSpeech);
  }, []);

  /* ---------- conversation edits ---------- */
  const updateMessages = (chatId: string, fn: (prev: Msg[]) => Msg[]): void => {
    setChats((prev) => prev.map((c) => (c.id === chatId ? { ...c, messages: fn(c.messages), updatedAt: Date.now() } : c)));
  };
  const setActiveMessages = (fn: (prev: Msg[]) => Msg[]): void => updateMessages(active?.id ?? '', fn);
  /* 11.0 — one turn at a time, and each turn owns its own reply. A turn tags
     the placeholder it adds; only that turn may patch it, so a stopped turn
     that finishes late can never write into the next turn's bubble, and it
     only clears `busy` when it is still the turn in flight. */
  const turnRef = useRef('');
  const [turnChatId, setTurnChatId] = useState('');
  const endTurn = (turn: string, controller: AbortController): void => {
    if (abortRef.current === controller) abortRef.current = null;
    if (turnRef.current !== turn) return;
    turnRef.current = '';
    setBusy(false);
  };
  /** A newer turn has begun since `turn` started (not merely: it was stopped). */
  const superseded = (turn: string): boolean => turnRef.current !== '' && turnRef.current !== turn;
  const patchTurn = (chatId: string, turn: string, patch: (m: Msg) => Msg): void =>
    updateMessages(chatId, (prev) => {
      const next = [...prev];
      for (let k = next.length - 1; k >= 0; k -= 1) {
        if (next[k].role === 'assistant' && next[k].turn === turn) {
          next[k] = patch(next[k]);
          break;
        }
      }
      return next;
    });

  const newChat = (): void => {
    // Reuse an existing blank chat instead of stacking another one.
    const blank = chats.find((c) => c.messages.length === 0);
    if (blank) {
      setActiveId(blank.id);
    } else {
      const c = freshChat();
      setChats((prev) => [c, ...prev]);
      setActiveId(c.id);
    }
    composerRef.current?.setText('');
    setSidebarOpen(false);
  };

  /**
   * 9.1.0 — a temporary chat: held in state only, never written to the device
   * (features/ai/chat/storage.ts drops it in `persistChats`), and never part of
   * an export. Closing the tab is all it takes to be rid of it.
   */
  const newTemporaryChat = (): void => {
    const c: Conversation = { ...freshChat(), title: 'Temporary chat', temporary: true };
    setChats((prev) => [c, ...prev]);
    setActiveId(c.id);
    composerRef.current?.setText('');
    setSidebarOpen(false);
    showToast('Temporary chat — nothing from it is saved on this device');
  };

  const stop = (): void => {
    abortRef.current?.abort();
    abortRef.current = null;
    turnRef.current = '';
    setBusy(false);
  };
  stopRef.current = stop;
  // Leaving the page ends the turn in flight.
  useEffect(() => () => abortRef.current?.abort(), []);

  const removeChat = (id: string): void => {
    const index = chats.findIndex((c) => c.id === id);
    const removed = chats[index];
    if (!removed) return;
    const wasActive = id === (active?.id ?? '');
    setChats((prev) => {
      const next = prev.filter((c) => c.id !== id);
      const list = next.length ? next : [freshChat()];
      if (wasActive) setActiveId(list[0].id);
      return list;
    });
    // An empty chat has nothing to bring back.
    if (!removed.messages.length) return;
    // The toast clamps a long title with CSS; slicing could split an Indic syllable.
    showToast(`Deleted “${removed.title}”`, () => {
      setChats((prev) => {
        if (prev.some((c) => c.id === removed.id)) return prev;
        const next = [...prev];
        next.splice(Math.min(index, next.length), 0, removed);
        return next;
      });
      if (wasActive) setActiveId(removed.id);
    });
  };

  const clearAllChats = (): void => {
    const snapshot = chats;
    const snapshotActive = activeId;
    const c = freshChat();
    stop();
    setChats([c]);
    setActiveId(c.id);
    setSettingsOpen(false);
    showToast(`Deleted ${snapshot.length} chat${snapshot.length === 1 ? '' : 's'}`, () => {
      setChats(snapshot);
      setActiveId(snapshotActive);
    });
  };

  const importFromFile = (text: string): string => {
    const result = importChats(text, chats);
    if (!result) return 'That file isn’t a VinaX AI chats export.';
    if (!result.added) return 'Nothing new in that file — every chat in it is already here.';
    setChats(result.chats);
    return `Imported ${result.added} chat${result.added === 1 ? '' : 's'}.`;
  };

  /* ---------- local exchanges (no engine call) ---------- */
  const pushExchange = (userText: string, reply: string, player = false): void => {
    setActiveMessages((prev) => [
      ...prev,
      { role: 'user', content: userText },
      player ? { role: 'assistant', content: reply, player: true } : { role: 'assistant', content: reply },
    ]);
  };
  const musicCommand = (text: string): Promise<boolean> =>
    tryMusicCommand(text, (line) => {
      pushExchange(text, line, true);
      voiceEngineRef.current?.speakDirect(line);
    });

  // Slash commands run on the device; a few seed an engine prompt.
  const runSlash = async (cmd: string, arg: string): Promise<boolean> => {
    const st = usePlayerStore.getState();
    const song = st.queue[st.index] ?? null;
    switch (cmd) {
      case 'clear':
        newChat();
        return true;
      case 'export':
        setExportOpen(true);
        return true;
      case 'prompts':
        setPromptsDraft('');
        return true;
      case 'think':
        setThink((v) => !v);
        return true;
      case 'now':
        pushExchange(
          '/now',
          song ? `Now playing: ${song.title} — ${song.artists?.[0]?.name ?? song.subtitle}` : 'Nothing is playing right now.',
          !!song,
        );
        return true;
      case 'mood':
        if (!arg) {
          pushExchange('/mood', 'Tell me a mood — try “/mood chill” or “/mood energetic”.');
          return true;
        }
        return musicCommand(`play ${arg} songs`);
      case 'summary':
        void sendRef.current('Summarise this conversation so far in five short bullets, then list any decisions or action items.');
        return true;
      case 'lyrics':
        if (!song) {
          pushExchange('/lyrics', 'Play a song first, then ask again.');
          return true;
        }
        setSongCtx(true);
        stateRef.current.songCtx = true;
        void sendRef.current(
          `Explain the meaning of “${song.title}” — what the lyrics are about, the mood, and any lines worth noticing. Keep it warm and brief.`,
        );
        return true;
      case 'playlist': {
        if (!arg) {
          pushExchange('/playlist', 'Describe a vibe — try “/playlist rainy evening in Telugu”.');
          return true;
        }
        const chatId = active?.id ?? '';
        const langs = useSettingsStore.getState().pinnedLanguages;
        const muted = useSettingsStore.getState().mutedLanguages ?? [];
        const turn = `${Date.now().toString(36)}-${nextTurnNumber()}`;
        const controller = new AbortController();
        turnRef.current = turn;
        abortRef.current = controller;
        setTurnChatId(chatId);
        setBusy(true);
        updateMessages(chatId, (prev) => [...prev, { role: 'user', content: `/playlist ${arg}` }, { role: 'assistant', content: '', turn }]);
        let reply = 'The playlist engine didn’t answer — try again in a moment.';
        try {
          const r = await generatePlaylist(arg, langs, muted, controller.signal);
          const ok = r.ok ? r.playlist : null;
          const lines = ok ? ok.songs.map((sg, i) => `${i + 1}. ${sg.title} — ${sg.artists?.[0]?.name ?? sg.subtitle}`).join('\n') : '';
          reply =
            ok && ok.songs.length
              ? `**${ok.name}**\n${ok.description}\n\n${lines}`
              : 'I couldn’t build that playlist right now — try a different vibe or a moment later.';
        } catch {
          /* the honest fallback line above */
        }
        if (controller.signal.aborted) reply = 'Stopped before the playlist was ready.';
        patchTurn(chatId, turn, () => ({ role: 'assistant', content: reply }));
        endTurn(turn, controller);
        return true;
      }
      default:
        return false;
    }
  };

  /* ---------- a turn ---------- */
  const send = async (
    raw: string,
    attachments: Attachment[] = [],
    retry?: { history: Msg[]; previousReply: string; user: Msg; media?: 'image' | 'music'; choice?: ModelChoice },
  ): Promise<void> => {
    const chatId = active?.id ?? '';
    const conversation = retry?.history ?? messages;
    const q = raw.trim();
    // The ref, not the `busy` state: a turn stopped a moment ago (speaking over
    // a reply) is over at once, before the next render.
    if ((!q && attachments.length === 0) || turnRef.current) return;

    // 10.3 — Create image / Create music clip: one prompt → one picture or one
    // clip, made by the model in the bar and shown in the thread. Before the
    // slash and music commands, so "play a sitar loop" makes a clip.
    // 11.0 — asking again for a picture or clip that failed goes back to the
    // maker (`retry.media`), not to the chat model.
    const mediaKind = retry ? retry.media : createKind;
    if (mediaKind) {
      if (!q) return;
      const kind = mediaKind;
      // Create works from the prompt alone: say so instead of dropping files silently.
      if (attachments.length) showToast('Attached files aren’t used when creating a picture or clip — only your prompt was sent');
      const pick = resolveMediaPick(catalog.providers, kind, createPicks[kind]);
      const turn = `${Date.now().toString(36)}-${nextTurnNumber()}`;
      const controller = new AbortController();
      turnRef.current = turn;
      abortRef.current = controller;
      setTurnChatId(chatId);
      setBusy(true);
      updateMessages(chatId, (prev) => [
        ...(retry ? retry.history : prev),
        { role: 'user', content: q },
        { role: 'assistant', content: '', creating: kind, turn },
      ]);
      setChats((prev) =>
        prev.map((c) => (c.id === chatId && (c.title === 'New chat' || !c.messages.length) ? { ...c, title: titleFromMessage(q) } : c)),
      );
      stickRef.current = true;
      const res = await createMedia(kind, q, pick, controller.signal);
      patchTurn(chatId, turn, () =>
        res.ok
          ? { role: 'assistant', content: `${kind === 'image' ? 'Made a picture' : 'Made a music clip'} for: ${q}`, media: res.media }
          : { role: 'assistant', content: res.line, mediaKind: kind },
      );
      endTurn(turn, controller);
      return;
    }

    const slash = !retry && attachments.length === 0 ? parseSlash(q) : null;
    if (slash && (await runSlash(slash.cmd, slash.arg))) return;
    if (!retry && q && attachments.length === 0 && (await musicCommand(q))) return;

    const imgs = retry
      ? (retry.user.images ?? []).filter(Boolean)
      : attachments.filter((p) => p.kind === 'image' && p.dataUrl).map((p) => p.dataUrl as string);
    // 11.0 — text files AND the text read out of PDFs go to the model.
    const content = retry ? q : foldAttachments(q, attachments);

    const userMsg: Msg = { role: 'user', content: content || '(image)', images: imgs.length ? imgs : undefined };
    const turn = `${Date.now().toString(36)}-${nextTurnNumber()}`;
    const controller = new AbortController();
    turnRef.current = turn;
    abortRef.current = controller;
    setTurnChatId(chatId);
    setBusy(true);
    updateMessages(chatId, () => [...conversation, userMsg, { role: 'assistant', content: '', turn }]);
    setChats((prev) =>
      prev.map((c) =>
        c.id === chatId && (c.title === 'New chat' || !c.messages.length)
          ? { ...c, title: titleFromMessage(q || (imgs.length ? 'Image chat' : (attachments[0]?.name ?? 'New chat'))) }
          : c,
      ),
    );
    // The listener just spoke: the thread follows them to the bottom (instantly,
    // so the follow-the-reply check above sees the bottom when the stream starts).
    stickRef.current = true;
    requestAnimationFrame(() => {
      listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'auto' });
      setAtBottom(true);
    });

    const now = stateRef.current;
    const voiceLive = Boolean(voiceEngineRef.current);
    const player = usePlayerStore.getState();

    // Anything that goes wrong while the request is being put together is a
    // failed turn with an honest line in the thread — never a stuck spinner.
    let result: ChatStreamResult;
    try {
      const body = await buildChatRequest(
        {
          voiceLive,
          // 11.2 — "Ask <another model>" on a pick that gave no answer sends
          // with that model at once (the state update lands a render later).
          choice: retry?.choice ?? now.choice,
          think: now.think,
          replyLang: now.replyLang,
          replyStyle: now.replyStyle,
          profile: now.profile,
          song: now.songCtx ? (player.queue[player.index] ?? null) : null,
          // 9.1.0 — the project's instructions and files ride every message in it.
          ...(active?.projectId ? { projectId: active.projectId } : {}),
          // 10.3 — Run code, when it is on and the model in use can (Auto
          // picks one that can; a pinned model that cannot is not asked).
          ...(codeConnectorOn() && featuresRef.current.code && codeSupportRef.current !== 'unsupported' ? { tools: [CODE_TOOL] } : {}),
        },
        { conversation, userMsg, query: q, images: imgs, previousReply: retry?.previousReply },
      );
      result = await runChatStream({
        endpoint: CHAT_ENDPOINT,
        headers: clientHeaders(),
        body,
        signal: controller.signal,
        onDelta: (delta) => {
          if (!superseded(turn)) voiceEngineRef.current?.feed(delta);
        },
        onUpdate: (st) => patchTurn(chatId, turn, (m) => ({ ...m, content: st.text })),
      });
    } catch {
      result = { state: initialStreamState(), failure: 'unavailable', aborted: controller.signal.aborted };
    }

    // A newer turn (the listener spoke over this one) owns the voice now.
    const voiceIsOurs = !superseded(turn);
    endTurn(turn, controller);
    // 11.0 — the server no longer lists the picked model: forget it everywhere
    // and fall back to Auto, so Retry (and every later message) works.
    if (result.failure === 'bad_model' && now.choice.mode === 'model') {
      setRecents(forgetChoice(now.choice));
      setChoice(AUTO);
    }
    const { state } = result;
    const split = splitFollowups(state.text.trim().replace(/\n{3,}/g, '\n\n'));
    const text =
      split.body ||
      (result.aborted
        ? 'Stopped before the reply began.'
        : state.text
          ? ''
          : result.pickIssue
            ? pickIssueMessage(result.pickIssue)
            : failureMessage(result.failure));
    // The service says when a reply was cut short mid-stream.
    const finalText = state.truncated && split.body ? `${split.body}\n\n_This answer was cut short — ask me to continue._` : text;
    // The chip names the engine that actually answered — so a reply rescued
    // by a sibling never wears the chosen model's name. 10.3 — no nickname
    // table: the server sends the model's original name and its provider.
    const engine = state.model;
    const engineProvider = isProviderId(state.provider) ? state.provider : undefined;
    // 8.2.0 — nothing arrived (the stream client already asked once more):
    // the line says why and the reply offers Retry, unless waiting cannot help.
    const failed = !result.aborted && !state.text && canRetry(result.failure);
    // 9.0 — nothing arrived and waiting cannot help (switched off, or the
    // day's limit): presentation only, the thread points back to the music.
    const unavailable = !result.aborted && !state.text && !canRetry(result.failure);
    patchTurn(chatId, turn, (m) => ({
      ...m,
      turn: undefined,
      failed: failed || undefined,
      needsEdit: (failed && needsEdit(result.failure)) || undefined,
      pickIssue: (failed && result.pickIssue) || undefined,
      unavailable: unavailable || undefined,
      content: finalText || '…',
      engine: engine || undefined,
      engineProvider: engine ? engineProvider : undefined,
      tools: engine && state.tools.length ? state.tools : undefined,
      // 11.0 — the pages a web-grounded reply drew on, kept with the chat.
      sources: engine && state.sources ? state.sources : undefined,
      followups: split.followups.length ? split.followups : undefined,
    }));
    if (!voiceIsOurs) return;
    if (voiceEngineRef.current) {
      if (split.body) voiceEngineRef.current.finish(finalText);
      else voiceEngineRef.current.cancelTurn();
    } else if (stateRef.current.autoRead && split.body && !result.aborted && readAloudSupported()) {
      // The reply is the last message: [...conversation, user, assistant].
      readAloud(`${chatId}:${conversation.length + 1}`, split.body);
    }
  };

  const sendRef = useRef(send);
  sendRef.current = send;

  /* ---------- reply actions ---------- */
  const regenerate = (): void => {
    if (busy || messages.length < 2) return;
    const lastUser = [...messages].reverse().find((m) => m.role === 'user');
    if (!lastUser) return;
    const lastReply = [...messages].reverse().find((m) => m.role === 'assistant');
    // A failed turn is asked again as it was, not "differently from" a failure line.
    const previousReply = lastReply && !lastReply.failed ? lastReply.content : '';
    // A picture or clip (made, or failed) is asked for again from the maker.
    const media = lastReply?.media?.kind ?? lastReply?.mediaKind;
    void send(lastUser.content, [], { history: messages.slice(0, messages.lastIndexOf(lastUser)), previousReply, user: lastUser, media });
  };
  /** 11.2 — the picked model gave no answer: ask the same question again with
   *  the model the listener chose from the notice (another model from the
   *  same provider, or Auto), which also becomes the current pick. */
  const askWith = (next: ModelChoice): void => {
    if (busy || messages.length < 2) return;
    const lastUser = [...messages].reverse().find((m) => m.role === 'user');
    if (!lastUser) return;
    applyChoice(next);
    void send(lastUser.content, [], { history: messages.slice(0, messages.lastIndexOf(lastUser)), previousReply: '', user: lastUser, choice: next });
  };
  const rewriteLast = (how: 'shorter' | 'longer' | 'simpler'): void => {
    if (busy) return;
    void send(
      how === 'shorter'
        ? 'Rewrite your last answer at half the length, keeping every fact.'
        : how === 'longer'
          ? 'Expand your last answer with more detail and examples, same structure.'
          : 'Rewrite your last answer in simpler words, as if for someone new to the topic.',
    );
  };
  const branchFrom = (idx: number): void => {
    if (!active) return;
    const c: Conversation = {
      ...freshChat(),
      title: `${active.title} · branch`,
      messages: active.messages.slice(0, idx + 1).map((m) => ({ ...m, pinned: undefined })),
    };
    setChats((prev) => [c, ...prev]);
    setActiveId(c.id);
    setSidebarOpen(false);
  };

  const messageHandlers = useStableHandlers<MessageHandlers>({
    /**
     * Edit and resend. 9.1.0 — the version being replaced is PRESERVED: the
     * conversation as it stands is kept as a branch chat before this one is
     * truncated, so an edit can never destroy an answer the listener may want
     * back. (9.0 called `slice(0, idx)` and the old turns were simply gone.)
     * A temporary chat is the exception — keeping a branch of it on the device
     * would defeat the point, so it is edited in place.
     */
    edit: (idx: number, content: string) => {
      if (busy || !active) return;
      if (!active.temporary && active.messages.length > idx) {
        const kept: Conversation = {
          ...freshChat(),
          title: `${active.title} · before edit`,
          messages: active.messages.map((m) => ({ ...m, pinned: undefined })),
        };
        setChats((prev) => [kept, ...prev]);
      }
      setActiveMessages((prev) => prev.slice(0, idx));
      composerRef.current?.setText(content);
    },
    rate: (idx: number, rating: 'up' | 'down') =>
      setActiveMessages((prev) => prev.map((m, k) => (k === idx ? { ...m, rating: m.rating === rating ? undefined : rating } : m))),
    togglePin: (idx: number) => setActiveMessages((prev) => prev.map((m, k) => (k === idx ? { ...m, pinned: !m.pinned } : m))),
    branch: branchFrom,
    regenerate,
    askWith,
    // 11.0 — a message that was turned away (too large, refused as it is):
    // the failed turn leaves the thread and its text returns to the box.
    reviseLast: () => {
      if (busy) return;
      const at = messages.map((m) => m.role).lastIndexOf('user');
      if (at < 0) return;
      const text = messages[at].content;
      setActiveMessages((prev) => prev.slice(0, at));
      composerRef.current?.setText(text);
      composerRef.current?.focus();
    },
    continueReply: () => {
      if (!busy) void send('Continue exactly from where you stopped.');
    },
    rewrite: rewriteLast,
    send: (text: string) => void send(text),
  });

  const sidebarHandlers = useStableHandlers<SidebarHandlers>({
    newChat,
    newTemporaryChat,
    openProjects: () => {
      setProjectsOpen(true);
      setSidebarOpen(false);
    },
    open: (id: string) => {
      setActiveId(id);
      setSidebarOpen(false);
    },
    rename: (id: string, title: string) =>
      setChats((prev) => prev.map((c) => (c.id === id ? { ...c, title: title.trim().slice(0, 80) || c.title } : c))),
    togglePin: (id: string) => setChats((prev) => prev.map((c) => (c.id === id ? { ...c, pinned: !c.pinned } : c))),
    remove: removeChat,
  });
  const closeSidebar = (): void => setSidebarOpen(false);
  const toggleCollapsed = (): void => {
    writeFlag(PREF.sidebarCollapsed, !sidebarCollapsed);
    setSidebarCollapsed(!sidebarCollapsed);
  };

  /* ---------- keyboard: ⌘/Ctrl+K new chat · ⌘/Ctrl+B chat list · Esc stop ---------- */
  // Ref-forwarded so the listener (attached once) never closes over a stale
  // copy of newChat / stop.
  const keysRef = useRef({ newChat, stop, toggleCollapsed });
  keysRef.current = { newChat, stop, toggleCollapsed };
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const chord = e.metaKey || e.ctrlKey;
      if (chord && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        keysRef.current.newChat();
      } else if (chord && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        if (window.matchMedia('(min-width: 768px)').matches) keysRef.current.toggleCollapsed();
        else setSidebarOpen((v) => !v);
      } else if (e.key === 'Escape') {
        keysRef.current.stop();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const onDropFiles = (event: DragEvent): void => {
    event.preventDefault();
    setDropActive(false);
    void droppedFiles(event.dataTransfer).then((sel) => composerRef.current?.addFiles(sel));
  };

  const openSettings = (): void => {
    setSettingsOpen(true);
    setExportOpen(false);
    setMenuOpen(false);
    // The voice list is fetched on first open, never on page load.
    loadVoices();
  };

  const modelMenu = menuOpen ? (
    <>
      <button type="button" aria-label="Close model menu" tabIndex={-1} onClick={() => setMenuOpen(false)} className="fixed inset-0 z-40 cursor-default" />
      {/* Placed in viewport coordinates against the chip (placeMenu): the
          composer is mid-screen on an empty chat and at the bottom of a
          thread, and on a phone the chip is nowhere near the right edge. */}
      <ModelMenu
        className={cn('ai-model-menu-pop ai-pop', menuPlace?.top === undefined ? 'ai-model-menu-up' : 'ai-model-menu-down')}
        style={menuPlace ?? undefined}
        state={catalog.state}
        providers={catalog.providers}
        current={choice}
        recents={recents}
        onPick={pickModel}
        onClose={() => {
          setMenuOpen(false);
          composerRef.current?.focus();
        }}
        onRetry={() => void catalog.load()}
      />
    </>
  ) : null;

  return (
    /* VinaX conversation surface, with theme-aware reading contrast. */
    <div className="ai-root ai-shell" data-chat-style={chatStyle.style} data-style-tick={chatStyle.tick} {...layoutAttrs(chatStyle.style)}>
      <ChatStyleContext.Provider value={chatStyle}>
      <Sidebar
        chats={chats}
        activeId={active?.id ?? ''}
        collapsed={sidebarCollapsed}
        onCollapse={toggleCollapsed}
        mobileOpen={sidebarOpen}
        onCloseMobile={closeSidebar}
        handlers={sidebarHandlers}
      />

      {promptsDraft !== null && (
        <SavedPromptsSheet draft={promptsDraft} onClose={() => setPromptsDraft(null)} onUse={(t) => composerRef.current?.setText(t)} />
      )}
      {voiceMode && (
        <LiveVoiceHost
          store={voice.store}
          levelRef={voice.levelRef}
          waveRef={voice.waveRef}
          onInterrupt={voice.interrupt}
          onToggleMute={voice.toggleMute}
          onEnd={voice.end}
        />
      )}
      {settingsOpen && (
        <SettingsDialog
          onClose={() => setSettingsOpen(false)}
          fontSize={fontSize}
          onFontSize={(f) => {
            setFontSize(f);
            writePref(PREF.fontSize, f);
          }}
          defaultChoice={defaultChoice}
          onDefaultChoice={(c) => {
            setDefaultChoice(c);
            saveDefaultChoice(c);
            // As the old "Default engine" select did: it applies right away too.
            if (c) applyChoice(c);
          }}
          catalogState={catalog.state}
          catalogProviders={catalog.providers}
          onLoadCatalog={() => void catalog.load()}
          recents={recents}
          sendOnEnter={sendOnEnter}
          onSendOnEnter={(on) => {
            setSendOnEnter(on);
            writeFlag(PREF.sendOnEnter, on);
          }}
          replyLang={replyLang}
          replyStyle={replyStyle}
          songCtx={songCtx}
          onReplyLang={(v) => {
            setReplyLang(v);
            writePref(PREF.replyLang, v);
          }}
          onReplyStyle={(v) => {
            setReplyStyle(v);
            writePref(PREF.replyStyle, v);
          }}
          onSongCtx={setSongCtx}
          profile={profile}
          onProfile={(v) => {
            setProfile(v);
            writePref(PREF.profile, v);
          }}
          voicePick={voicePick}
          onVoicePick={(v) => {
            setVoicePick(v);
            writePref(PREF.voice, v);
          }}
          voiceCatalog={voiceCatalog}
          dictationPick={dictationPick}
          onDictationPick={(pk) => {
            setDictationPick(pk);
            saveMediaPick('transcription', pk);
          }}
          autoRead={autoRead}
          onAutoRead={(on) => {
            setAutoRead(on);
            writeFlag(PREF.autoRead, on);
          }}
          chatCount={chats.filter((c) => c.messages.length).length}
          onExportAll={() => exportAllChats(chats)}
          onImport={importFromFile}
          onClearAll={clearAllChats}
        />
      )}

      {/* Main */}
      <div className="ai-main">
        {/* Header: the chat's name and nothing that competes with it. The
            model lives beside the composer, where it is chosen. */}
        <header className="ai-header">
          <button type="button" className="ai-icon-btn ai-below-md" aria-label="Menu" aria-expanded={sidebarOpen} onClick={() => setSidebarOpen(true)}>
            <MenuIcon className="w-5 h-5" />
          </button>
          {sidebarCollapsed && (
            <>
              <button type="button" className="ai-icon-btn ai-from-md" aria-label="Show chat list" title="Show chat list (Ctrl/⌘+B)" onClick={toggleCollapsed}>
                <PanelIcon className="w-5 h-5" />
              </button>
              <button type="button" className="ai-icon-btn ai-from-md" aria-label="New chat" title="New chat (Ctrl/⌘+K)" onClick={newChat}>
                <PlusIcon className="w-5 h-5" />
              </button>
            </>
          )}
          <div className="min-w-0 flex-1">
            <h1 className="ai-header-title">{active?.title ?? 'VinaX AI'}</h1>
            <p className="ai-header-sub md:hidden">
              {modelLabel}
              {think ? ' · Think' : ''}
              {voiceMode ? ' · Voice' : ''}
            </p>
          </div>
          {/* 9.1.0 — artifacts: everything this chat wrote, with its versions. */}
          {artifactCount > 0 && (
            <button
              type="button"
              onClick={() => setArtifactsOpen((v) => !v)}
              aria-label={artifactsOpen ? 'Hide artifacts' : `Show artifacts (${artifactCount})`}
              title="Documents, pages and code from this chat"
              aria-expanded={artifactsOpen}
              className={cn('ai-icon-btn ai-artifacts-toggle', artifactsOpen && 'ai-icon-btn-on')}
            >
              <FileIcon className="w-5 h-5" />
              <span className="ai-artifacts-count">{artifactCount}</span>
            </button>
          )}
          <div className="relative">
            <button
              type="button"
              onClick={() => setExportOpen((v) => !v)}
              aria-label="Export chat"
              title="Export chat"
              aria-haspopup="menu"
              aria-expanded={exportOpen}
              className={cn('ai-icon-btn', exportOpen && 'ai-icon-btn-on')}
            >
              <DownloadIcon className="w-5 h-5" />
            </button>
            {exportOpen && (
              <>
                <button type="button" aria-label="Close export menu" tabIndex={-1} onClick={() => setExportOpen(false)} className="fixed inset-0 z-40 cursor-default" />
                <div
                  role="menu"
                  aria-label="Export chat"
                  className="ai-popover ai-pop absolute right-0 top-full mt-1.5 z-50 w-56"
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      e.stopPropagation();
                      setExportOpen(false);
                    }
                  }}
                >
                  {(['txt', 'md', 'pdf'] as const).map((k) => (
                    <button
                      key={k}
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        if (active) exportChat(active, k);
                        setExportOpen(false);
                      }}
                      className="ai-menu-item"
                    >
                      {k === 'txt' ? 'Plain text (.txt)' : k === 'md' ? 'Markdown (.md)' : 'PDF (print)'}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
          <button type="button" onClick={openSettings} aria-label="Chat settings" title="Chat settings" aria-haspopup="dialog" className="ai-icon-btn">
            <SettingsIcon className="w-5 h-5" />
          </button>
        </header>

        {/* Stage: ONE composer instance in one tree position. On an empty chat
            the stage centres greeting → composer → suggestions; once there
            are messages the thread takes the space and the composer docks. */}
        <div
          className={cn('ai-stage', isEmpty && 'ai-stage-empty', fontSize === 's' ? 'text-[14px]' : fontSize === 'l' ? 'text-[18px]' : 'text-[16px]')}
          onDragEnter={(e) => {
            e.preventDefault();
            setDropActive(true);
          }}
          onDragOver={(e) => e.preventDefault()}
          onDragLeave={(e) => {
            if (e.currentTarget === e.target) setDropActive(false);
          }}
          onDrop={onDropFiles}
        >
          {dropActive && (
            <div className="ai-drop-overlay" role="status" aria-live="polite">
              <div>
                <PlusIcon className="w-7 h-7" />
                <strong>Drop files or a folder</strong>
                <span>Images, text, code and CSV files are supported</span>
              </div>
            </div>
          )}
          {isEmpty && <Greeting userName={userName} />}
          <div ref={listRef} className="ai-scroller" hidden={isEmpty} onScroll={measureBottom}>
            {!isEmpty && (
              <MessageList
                key={active?.id ?? ''}
                onReady={(goTo) => {
                  jumpToMessage.current = goTo;
                }}
                chatId={active?.id ?? ''}
                messages={messages}
                busy={busy}
                streamingHere={turnChatId === (active?.id ?? '')}
                speakingId={speakingId}
                handlers={messageHandlers}
              />
            )}
          </div>
          {!isEmpty && !atBottom && (
            <div className="ai-jump-anchor">
              <button
                type="button"
                className="ai-jump"
                onClick={() => {
                  const list = listRef.current;
                  if (!list) return;
                  // While a reply streams, instant: a smooth scroll would land short of a growing reply.
                  const behavior = busy ? 'auto' : scrollBehavior();
                  jumpingRef.current = behavior === 'smooth';
                  stickRef.current = true;
                  setAtBottom(true);
                  list.scrollTo({ top: list.scrollHeight, behavior });
                  // A reader who scrolls away mid-jump is measured again.
                  if (jumpingRef.current) {
                    window.setTimeout(() => {
                      jumpingRef.current = false;
                      measureBottom();
                    }, 900);
                  }
                }}
              >
                <ChevronDownIcon /> Jump to latest
              </button>
            </div>
          )}
          <Composer
            ref={composerRef}
            busy={busy}
            docked={!isEmpty}
            modelLabel={modelLabel}
            modelProvider={modelProvider}
            menuOpen={menuOpen}
            onToggleMenu={toggleMenu}
            menu={modelMenu}
            think={think}
            onThink={setThink}
            songCtx={songCtx}
            onSongCtx={setSongCtx}
            createKind={createKind}
            onCreateKind={setCreateKind}
            createBar={
              createKind ? (
                <CreateBar
                  kind={createKind}
                  groups={mediaGroups(catalog.providers, createKind)}
                  state={catalog.state}
                  pick={resolveMediaPick(catalog.providers, createKind, createPicks[createKind])}
                  docked={!isEmpty}
                  onPick={(pk) => {
                    setCreatePicks((prev) => ({ ...prev, [createKind]: pk }));
                    saveMediaPick(createKind, pk);
                  }}
                  onCancel={() => setCreateKind(null)}
                />
              ) : null
            }
            features={catalog.features}
            onToolsOpen={() => void catalog.load()}
            codeSupport={codeSupport}
            dictationPick={dictationPick}
            canSpeech={canSpeech}
            voiceMode={voiceMode}
            onToggleVoice={voiceMode ? voice.end : voice.start}
            sendOnEnter={sendOnEnter}
            onSend={(text, files) => void send(text, files)}
            onStop={stop}
            onOpenPrompts={() => setPromptsDraft(composerRef.current?.getText() ?? '')}
          />
          {isEmpty && (
            <Suggestions
              starters={starters}
              quickActions={quickActions}
              onSend={messageHandlers.send}
              onQuick={(qa) => composerRef.current?.setText(qa.prompt)}
              onOpenPrompts={() => setPromptsDraft(composerRef.current?.getText() ?? '')}
            />
          )}
        </div>
      </div>

      {/* 9.1.0 — the artifact panel, beside the chat on wide screens and over it
          on phones. Lazy: the chat page never pays for it until it is opened. */}
      {artifactsOpen && (
        <Suspense fallback={<aside className="ai-artifacts" aria-label="Artifacts"><p className="ai-artifacts-empty">Collecting…</p></aside>}>
          <ArtifactPanel
            messages={messages}
            onClose={() => setArtifactsOpen(false)}
            onJump={(index) => jumpToMessage.current?.(index)}
          />
        </Suspense>
      )}

      {projectsOpen && (
        <Suspense fallback={null}>
          <ProjectSheet
            currentChatProjectId={active?.projectId}
            onAssign={(projectId) => {
              const id = active?.id;
              if (!id) return;
              setChats((prev) => prev.map((c) => (c.id === id ? { ...c, projectId, updatedAt: Date.now() } : c)));
              showToast(projectId ? 'This chat is in that project now' : 'This chat is no longer in a project');
            }}
            onClose={() => setProjectsOpen(false)}
          />
        </Suspense>
      )}

      {toast && <Toast toast={toast} onDone={clearToast} />}
      {/* The app's own toasts (Queued …, Saved …): this route renders outside
          AppLayout, so without a host here they were never shown. */}
      <div className="ai-app-toasts">
        <Toasts />
      </div>
      </ChatStyleContext.Provider>
    </div>
  );
}

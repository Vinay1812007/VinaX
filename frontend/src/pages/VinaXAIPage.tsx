import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from 'react';
import '@/styles/ai.css';
import { DownloadIcon, PlusIcon, SettingsIcon } from '@/components/Icons';
import { SavedPromptsSheet } from '@/components/ai/AiExtras';
import { droppedFiles, attachmentText, type Attachment } from '@/features/ai/attachments';
import { splitFollowups } from '@/features/ai/followups';
import { onSpeakingChange, readAloud, readAloudSupported, setReadAloudVoice } from '@/features/ai/readAloud';
import { parseSlash } from '@/features/ai/slashCommands';
import { Composer, type AgentAvailability, type ComposerHandle } from '@/features/ai/chat/Composer';
import { Greeting, Suggestions, type QuickAction } from '@/features/ai/chat/EmptyState';
import { LiveVoiceHost } from '@/features/ai/chat/LiveVoiceHost';
import { MessageList } from '@/features/ai/chat/MessageList';
import type { MessageHandlers } from '@/features/ai/chat/Message';
import { ModelMenu } from '@/features/ai/chat/ModelMenu';
import { DEVICE_VOICE, SettingsDialog, type VoiceCatalog } from '@/features/ai/chat/SettingsDialog';
import { Sidebar, type SidebarHandlers } from '@/features/ai/chat/Sidebar';
import { Toast, type ToastState } from '@/features/ai/chat/Toast';
import { buildChatRequest } from '@/features/ai/chat/buildChatRequest';
import { CHAT_ENDPOINT, IMAGE_ENDPOINT, VOICES_ENDPOINT, clientHeaders } from '@/features/ai/chat/endpoints';
import { MenuIcon, PanelIcon } from '@/features/ai/chat/icons';
import {
  agentChoices,
  bestAgentChoice,
  choiceLabel,
  isAgentChoice,
  isMode,
  loadDefaultChoice,
  loadInitialChoice,
  loadRecents,
  nickForModel,
  normaliseChoice,
  pushRecent,
  saveCatalogPick,
  saveDefaultChoice,
  saveLastChoice,
  saveRecents,
  slugLabel,
} from '@/features/ai/chat/models';
import { tryMusicCommand } from '@/features/ai/chat/musicCommands';
import { QUICK_ACTIONS, drawStarters } from '@/features/ai/chat/starters';
import { placeMenu, type MenuPlacement } from '@/features/ai/chat/placeMenu';
import {
  PREF,
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
} from '@/features/ai/chat/storage';
import { failureMessage, runChatStream, type ChatStreamResult } from '@/features/ai/chat/streamClient';
import { initialStreamState } from '@/features/ai/chat/streamReducer';
import type { Conversation, ModelChoice, Msg } from '@/features/ai/chat/types';
import { useModelCatalog } from '@/features/ai/chat/useModelCatalog';
import { useLiveVoice } from '@/features/ai/chat/useLiveVoice';
import { useStableHandlers } from '@/features/ai/chat/useStableHandlers';
import { useClientConfig } from '@/features/home/useAppConfig';
import { probeSttSupport, sttSupported } from '@/features/voice/stt';
import { usePageMeta } from '@/hooks/usePageMeta';
import { generatePlaylist } from '@/services/ai/playlist';
import { usePlayerStore } from '@/store/playerStore';
import { useSettingsStore } from '@/store/settingsStore';
import { cn } from '@/utils/cn';
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

export default function VinaXAIPage(): ReactNode {
  /* ---------- conversations ---------- */
  const [chats, setChats] = useState<Conversation[]>(loadInitialChats);
  const [activeId, setActiveId] = useState<string>(() => '');
  const active = useMemo(() => chats.find((c) => c.id === activeId) ?? chats[0], [chats, activeId]);
  const messages = active?.messages ?? [];
  const isEmpty = messages.length === 0;
  const [busy, setBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  /* ---------- model + agent ---------- */
  const [choice, setChoice] = useState<ModelChoice>(loadInitialChoice);
  const [defaultChoice, setDefaultChoice] = useState<ModelChoice | null>(loadDefaultChoice);
  const [recents, setRecents] = useState<ModelChoice[]>(loadRecents);
  const [menuOpen, setMenuOpen] = useState(false);
  const catalog = useModelCatalog();
  const [agentOn, setAgentOn] = useState(false);
  const [agentStart, setAgentStart] = useState(() => readFlag(PREF.agentStart, false));
  /** The model to go back to when Agent mode is switched off again. */
  const beforeAgentRef = useRef<ModelChoice | null>(null);

  /* ---------- composer toggles ---------- */
  const [web, setWeb] = useState(false);
  // Think routes the next messages to the deep lane; Research forces
  // multi-source web answers.
  const [think, setThink] = useState(false);
  const [research, setResearch] = useState(false);
  const [imageMode, setImageMode] = useState(false);

  /* ---------- preferences (each on its long-standing key) ---------- */
  const [profile, setProfile] = useState(() => readPref(PREF.profile, ''));
  const [fontSize, setFontSize] = useState<FontSize>(readFontSize);
  const [replyLang, setReplyLang] = useState(() => readPref(PREF.replyLang, 'auto'));
  const [replyStyle, setReplyStyle] = useState(() => readPref(PREF.replyStyle, 'auto'));
  const [songCtx, setSongCtx] = useState(false);
  const [sendOnEnter, setSendOnEnter] = useState(() => readFlag(PREF.sendOnEnter, true));
  const [autoRead, setAutoRead] = useState(() => readFlag(PREF.autoRead, false));
  // Voice: `${model}|${persona}`, or DEVICE_VOICE ('device' = the browser's
  // own speech engine — always available, works offline). One string, so a
  // half-set preference is impossible.
  const [voicePick, setVoicePick] = useState(() => readPref(PREF.voice, DEVICE_VOICE) || DEVICE_VOICE);
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
  useEffect(() => {
    const onHide = (): void => persistChats(chats);
    window.addEventListener('pagehide', onHide);
    return () => window.removeEventListener('pagehide', onHide);
  }, [chats]);
  // Follow the newest reply, but ONLY if the reader is already near the
  // bottom — never yank someone back down while they re-read an earlier reply.
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const nearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 80;
    if (nearBottom) list.scrollTo({ top: list.scrollHeight });
  }, [chats, activeId]);

  // Browser tab mirrors the open conversation.
  const chatTitle = active && active.messages.length && active.title !== 'New chat' ? active.title : null;
  usePageMeta({
    title: chatTitle ?? 'VinaX AI — ask anything',
    description:
      'Chat with VinaX AI — ask anything, search the live web, and get clean answers with code, tables and images. Free, private, no login.',
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
  const stateRef = useRef({ choice, agentOn, web, think, research, profile, replyLang, replyStyle, songCtx, autoRead, groups: catalog.groups });
  stateRef.current = { choice, agentOn, web, think, research, profile, replyLang, replyStyle, songCtx, autoRead, groups: catalog.groups };

  /* ---------- model selection ---------- */
  const applyChoice = useCallback((next: ModelChoice): void => {
    const c = normaliseChoice(next);
    setChoice(c);
    saveLastChoice(c);
    // The per-catalogue pick keeps its long-standing key, so an older build
    // (or the default-model setting) reads the same choice.
    saveCatalogPick(c);
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
    // load — a listener who stays on a pinned engine pays nothing for it.
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

  const agentAvailability: AgentAvailability =
    catalog.state === 'loading'
      ? 'loading'
      : catalog.state === 'ready'
        ? agentChoices(catalog.groups).length
          ? 'available'
          : 'none'
        : 'unknown';

  const loadCatalog = catalog.load;
  const turnAgentOn = useCallback(
    async (quiet: boolean): Promise<void> => {
      const groups = await loadCatalog();
      const best = bestAgentChoice(groups);
      if (!best) {
        if (!quiet) showToast('No agent model is available right now.');
        return;
      }
      setAgentOn(true);
      const current = stateRef.current.choice;
      if (!isAgentChoice(current, groups)) {
        beforeAgentRef.current = current;
        applyChoice(best);
      }
    },
    [applyChoice, loadCatalog, showToast],
  );
  const toggleAgent = (): void => {
    if (!agentOn) {
      void turnAgentOn(false);
      return;
    }
    setAgentOn(false);
    const back = beforeAgentRef.current;
    beforeAgentRef.current = null;
    if (back) applyChoice(back);
  };
  // "Start in Agent mode" — the one case where the catalogue is asked for
  // before the menu opens, because the listener asked for exactly that.
  useEffect(() => {
    if (readFlag(PREF.agentStart, false)) void turnAgentOn(true);
  }, [turnAgentOn]);
  // An agent model that stops being served takes Agent mode with it.
  useEffect(() => {
    if (agentOn && catalog.state === 'ready' && !agentChoices(catalog.groups).length) setAgentOn(false);
  }, [agentOn, catalog.state, catalog.groups]);

  // Agent mode means "an agent model is answering": moving to a plain model
  // by any route (a quick action, the default-model setting) switches it off.
  useEffect(() => {
    if (agentOn && catalog.state === 'ready' && !isAgentChoice(choice, catalog.groups)) setAgentOn(false);
  }, [agentOn, choice, catalog.state, catalog.groups]);

  const agentActive = agentOn && isAgentChoice(choice, catalog.groups);
  const modelLabel = choiceLabel(choice);

  /* ---------- voice ---------- */
  // The engine reads this on every spoken chunk, so changing the voice in
  // Settings takes effect on the next sentence, not the next session.
  const voicePickRef = useRef(voicePick);
  voicePickRef.current = voicePick;
  /** What the voice route should use for the next chunk: null means speak on
   *  this device, which is also the answer when no speech model is served. */
  const serverVoice = useCallback((): { model: string; voice: string } | null => {
    const v = voicePickRef.current;
    if (!v || v === DEVICE_VOICE) return null;
    const [model, voice] = v.split('|');
    return model && voice ? { model, voice } : null;
  }, []);
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
    void fetch(VOICES_ENDPOINT)
      .then((r) => (r.ok ? (r.json() as Promise<VoiceCatalog>) : Promise.reject(new Error('bad response'))))
      .then((j) =>
        setVoiceCatalog({
          configured: Boolean(j.configured),
          models: Array.isArray(j.models) ? j.models : [],
          personas: Array.isArray(j.personas) ? j.personas : [],
        }),
      )
      .catch(() => setVoiceCatalog({ configured: false, models: [], personas: [] }));
  }, []);

  // The live voice chat: engine, overlay state and waveform live in the hook;
  // the page only needs to know whether one is running and to feed it text.
  const stopRef = useRef<() => void>(() => undefined);
  const voice = useLiveVoice({
    getServerVoice: serverVoice,
    onUserFinal: (text) => void sendRef.current(text),
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
  const replaceLastAssistant = (chatId: string, patch: (m: Msg) => Msg): void =>
    updateMessages(chatId, (prev) => {
      const next = [...prev];
      for (let k = next.length - 1; k >= 0; k -= 1) {
        if (next[k].role === 'assistant') {
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

  const stop = (): void => {
    abortRef.current?.abort();
    abortRef.current = null;
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
    showToast(`Deleted “${removed.title.slice(0, 40)}”`, () => {
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
      case 'web':
        setWeb((v) => !v);
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
        updateMessages(chatId, (prev) => [...prev, { role: 'user', content: `/playlist ${arg}` }, { role: 'assistant', content: '' }]);
        setBusy(true);
        let reply = 'The playlist engine didn’t answer — try again in a moment.';
        try {
          const r = await generatePlaylist(arg, langs, muted);
          const ok = r.ok ? r.playlist : null;
          const lines = ok ? ok.songs.map((sg, i) => `${i + 1}. ${sg.title} — ${sg.artists?.[0]?.name ?? sg.subtitle}`).join('\n') : '';
          reply =
            ok && ok.songs.length
              ? `**${ok.name}**\n${ok.description}\n\n${lines}`
              : 'I couldn’t build that playlist right now — try a different vibe or a moment later.';
        } catch {
          /* the honest fallback line above */
        }
        replaceLastAssistant(chatId, () => ({ role: 'assistant', content: reply }));
        setBusy(false);
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
    retry?: { history: Msg[]; previousReply: string; user: Msg },
  ): Promise<void> => {
    const chatId = active?.id ?? '';
    const conversation = retry?.history ?? messages;
    const q = raw.trim();
    if ((!q && attachments.length === 0) || busy) return;
    const slash = !retry && attachments.length === 0 ? parseSlash(q) : null;
    if (slash && (await runSlash(slash.cmd, slash.arg))) return;
    if (!retry && q && attachments.length === 0 && (await musicCommand(q))) return;

    // Image mode: one prompt → one picture, rendered in the chat.
    if (imageMode && !retry) {
      if (!q) return;
      setImageMode(false);
      setBusy(true);
      updateMessages(chatId, (prev) => [...prev, { role: 'user', content: q }, { role: 'assistant', content: '' }]);
      let reply: Msg = { role: 'assistant', content: 'The image engine didn’t answer — try once more in a moment.' };
      try {
        const r = await fetch(IMAGE_ENDPOINT, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ prompt: q }),
        });
        const j = (await r.json().catch(() => null)) as { image?: string; error?: string } | null;
        if (j?.image) reply = { role: 'assistant', content: 'Here you go', images: [j.image] };
        else if (j?.error === 'not_enabled' || j?.error === 'model_unavailable')
          reply = { role: 'assistant', content: 'Image creation isn’t enabled on the server yet — everything else still works.' };
      } catch {
        /* the honest fallback line above */
      }
      replaceLastAssistant(chatId, () => reply);
      setBusy(false);
      return;
    }

    const imgs = retry
      ? (retry.user.images ?? []).filter(Boolean)
      : attachments.filter((p) => p.kind === 'image' && p.dataUrl).map((p) => p.dataUrl as string);
    let content = q;
    if (!retry) for (const f of attachments.filter((p) => p.kind === 'text')) content += attachmentText(f);

    const userMsg: Msg = { role: 'user', content: content || '(image)', images: imgs.length ? imgs : undefined };
    updateMessages(chatId, () => [...conversation, userMsg, { role: 'assistant', content: '' }]);
    setChats((prev) =>
      prev.map((c) =>
        c.id === chatId && (c.title === 'New chat' || !c.messages.length) ? { ...c, title: (q || 'Image chat').slice(0, 42) } : c,
      ),
    );
    // The listener just spoke: the thread follows them to the bottom.
    requestAnimationFrame(() => listRef.current?.scrollTo({ top: listRef.current.scrollHeight }));

    const now = stateRef.current;
    const voiceLive = Boolean(voiceEngineRef.current);
    const agent = !voiceLive && now.agentOn && isAgentChoice(now.choice, now.groups);
    const player = usePlayerStore.getState();
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);

    // Anything that goes wrong while the request is being put together is a
    // failed turn with an honest line in the thread — never a stuck spinner.
    let result: ChatStreamResult;
    try {
      const body = await buildChatRequest(
        {
          voiceLive,
          choice: now.choice,
          agent,
          web: now.web,
          think: now.think,
          research: now.research,
          replyLang: now.replyLang,
          replyStyle: now.replyStyle,
          profile: now.profile,
          song: now.songCtx ? (player.queue[player.index] ?? null) : null,
        },
        { conversation, userMsg, query: q, images: imgs, previousReply: retry?.previousReply },
      );
      result = await runChatStream({
        endpoint: CHAT_ENDPOINT,
        headers: clientHeaders(),
        body,
        signal: controller.signal,
        onDelta: (delta) => voiceEngineRef.current?.feed(delta),
        onUpdate: (st) =>
          replaceLastAssistant(chatId, (m) => ({ ...m, content: st.text, steps: st.steps.length ? st.steps : m.steps })),
      });
    } catch {
      result = { state: initialStreamState(), failure: 'unavailable', aborted: controller.signal.aborted };
    }

    if (abortRef.current === controller) abortRef.current = null;
    setBusy(false);
    const { state } = result;
    const split = splitFollowups(state.text.trim().replace(/\n{3,}/g, '\n\n'));
    const text =
      split.body ||
      (result.aborted ? 'Stopped before the reply began.' : state.text ? '' : failureMessage(result.failure));
    // The service says when a reply was cut short mid-stream.
    const finalText = state.truncated && split.body ? `${split.body}\n\n_This answer was cut short — ask me to continue._` : text;
    // The chip names the engine that actually answered — so a reply rescued
    // by a sibling never wears the chosen model's name. A catalogue model the
    // listener picked keeps its own name, exactly as the server labels it.
    const engine = !state.model
      ? ''
      : now.choice.model && state.model === now.choice.model
        ? slugLabel(state.model)
        : nickForModel(state.model);
    replaceLastAssistant(chatId, (m) => ({
      ...m,
      content: finalText || '…',
      sources: state.sources.length ? state.sources : undefined,
      engine: engine || undefined,
      followups: split.followups.length ? split.followups : undefined,
      steps: state.steps.length ? state.steps : undefined,
    }));
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
    const previousReply = [...messages].reverse().find((m) => m.role === 'assistant')?.content ?? '';
    void send(lastUser.content, [], { history: messages.slice(0, messages.lastIndexOf(lastUser)), previousReply, user: lastUser });
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
    edit: (idx: number, content: string) => {
      if (busy) return;
      setActiveMessages((prev) => prev.slice(0, idx));
      composerRef.current?.setText(content);
    },
    rate: (idx: number, rating: 'up' | 'down') =>
      setActiveMessages((prev) => prev.map((m, k) => (k === idx ? { ...m, rating: m.rating === rating ? undefined : rating } : m))),
    togglePin: (idx: number) => setActiveMessages((prev) => prev.map((m, k) => (k === idx ? { ...m, pinned: !m.pinned } : m))),
    branch: branchFrom,
    regenerate,
    continueReply: () => {
      if (!busy) void send('Continue exactly from where you stopped.');
    },
    rewrite: rewriteLast,
    send: (text: string) => void send(text),
  });

  const sidebarHandlers = useStableHandlers<SidebarHandlers>({
    newChat,
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
        groups={catalog.groups}
        current={choice}
        recents={recents}
        agentOnly={agentOn}
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
    <div className="ai-root ai-shell">
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
          catalogGroups={catalog.groups}
          onLoadCatalog={() => void catalog.load()}
          recents={recents}
          sendOnEnter={sendOnEnter}
          onSendOnEnter={(on) => {
            setSendOnEnter(on);
            writeFlag(PREF.sendOnEnter, on);
          }}
          agentStart={agentStart}
          onAgentStart={(on) => {
            setAgentStart(on);
            writeFlag(PREF.agentStart, on);
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
            <MenuIcon className="w-[18px] h-[18px]" />
          </button>
          {sidebarCollapsed && (
            <>
              <button type="button" className="ai-icon-btn ai-from-md" aria-label="Show chat list" title="Show chat list (Ctrl/⌘+B)" onClick={toggleCollapsed}>
                <PanelIcon className="w-[18px] h-[18px]" />
              </button>
              <button type="button" className="ai-icon-btn ai-from-md" aria-label="New chat" title="New chat (Ctrl/⌘+K)" onClick={newChat}>
                <PlusIcon className="w-[18px] h-[18px]" />
              </button>
            </>
          )}
          <div className="min-w-0 flex-1">
            <h1 className="min-w-0 truncate font-semibold ai-t2">{active?.title ?? 'VinaX AI'}</h1>
            <p className="text-[11px] ai-t3 leading-tight truncate md:hidden">
              {modelLabel}
              {agentOn ? ' · Agent' : ''}
              {think ? ' · Think' : ''}
              {voiceMode ? ' · Voice' : ''}
            </p>
          </div>
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
              <DownloadIcon className="w-[18px] h-[18px]" />
            </button>
            {exportOpen && (
              <>
                <button type="button" aria-label="Close export menu" tabIndex={-1} onClick={() => setExportOpen(false)} className="fixed inset-0 z-40 cursor-default" />
                <div
                  role="menu"
                  aria-label="Export chat"
                  className="ai-popover ai-pop absolute right-0 top-full mt-1.5 z-50 w-48"
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
            <SettingsIcon className="w-[18px] h-[18px]" />
          </button>
        </header>

        {/* Stage: ONE composer instance in one tree position. On an empty chat
            the stage centres greeting → composer → suggestions; once there
            are messages the thread takes the space and the composer docks. */}
        <div
          className={cn('ai-stage', isEmpty && 'ai-stage-empty', fontSize === 's' ? 'text-[13px]' : fontSize === 'l' ? 'text-[17px]' : 'text-[15px]')}
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
          <div ref={listRef} className="ai-scroller" hidden={isEmpty}>
            {!isEmpty && (
              <MessageList
                key={active?.id ?? ''}
                chatId={active?.id ?? ''}
                messages={messages}
                busy={busy}
                speakingId={speakingId}
                agent={agentActive}
                handlers={messageHandlers}
              />
            )}
          </div>
          <Composer
            ref={composerRef}
            busy={busy}
            docked={!isEmpty}
            modelLabel={modelLabel}
            menuOpen={menuOpen}
            onToggleMenu={toggleMenu}
            menu={modelMenu}
            agentOn={agentOn}
            agentAvailability={agentAvailability}
            onToggleAgent={toggleAgent}
            web={web}
            think={think}
            research={research}
            onWeb={setWeb}
            onThink={setThink}
            onResearch={(on) => {
              // Research always searches the live web.
              if (on) setWeb(true);
              setResearch(on);
            }}
            imageMode={imageMode}
            onImageMode={setImageMode}
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
              onQuick={(qa) => {
                if (isMode(qa.mode)) applyChoice({ mode: qa.mode });
                composerRef.current?.setText(qa.prompt);
              }}
              onOpenPrompts={() => setPromptsDraft(composerRef.current?.getText() ?? '')}
            />
          )}
        </div>
      </div>

      {toast && <Toast toast={toast} onDone={clearToast} />}
    </div>
  );
}

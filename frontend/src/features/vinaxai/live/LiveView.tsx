/**
 * VinaX AI — Live voice: a full-screen view for talking with VinaX AI out
 * loud. Music pauses while it is open. Captions show what each side says;
 * when it closes, the conversation is saved into the chat as ordinary
 * messages (POST /api/ai/live-transcript) and the chat reloads to show it.
 * With web search on, the sources of the latest reply show under the
 * captions; the globe button switches search (Live voice reconnects).
 * The model, the voice and the language can be switched here at any time,
 * even while it connects (it reconnects and carries on). Tapping the orb
 * cuts VinaX AI off; the captions button hides or shows what is said.
 * The call can go to the background (the arrow at the top): it shrinks to a
 * small bar above the player and keeps going while the listener browses
 * VinaX (LiveHost, liveCall.ts). VinaX AI can play, pause and skip music
 * (musicTools.ts); while music plays the mic is muted so the song isn't
 * taken for speech, and unmuting pauses the music. The camera, the screen
 * and photos can be shown to it (liveVideo.ts), with a preview while shared.
 * Loaded on demand, only when someone opens it.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useDismissOnBack } from '@/hooks/useDismissOnBack';
import { saveLiveTranscript, voiceNotice } from '../api';
import { cleanMicLabel, listMics, micNotice, silentMicNotice, type MicDevice, type MicProblem } from '../mic';
import { personalOf, usePrefs } from '../prefs';
import { holdMusic } from '../musicHold';
import { CaptionsIcon, CloseIcon, FlipIcon, GlobeSmallIcon, ImageIcon, MicIcon, MicOffIcon, MinimizeIcon, ScreenIcon, SpeakerIcon, VideoIcon } from '../icons';
import { usePlayerStore } from '@/store/playerStore';
import { cameraSupported, FrameShare, photoFrame, screenShareSupported, type ShareKind } from './liveVideo';
import { isNativePlatform } from '@/services/native';
import { audioRouteAvailable, type AudioRoute } from './audioRoute';
import { SourcesRow } from '../Sources';
import type { SourcesInfo, VoiceInfo } from '../types';
import { voiceLabel } from './liveOptions';
import { LiveSession, type LiveEndReason, type LiveState } from './liveSession';

export interface LiveViewProps {
  conversationId: string | null;
  /** The message the session's first turn hangs on (the chat's current leaf). */
  parentMessageId: string | null;
  thinking: boolean;
  voice: string;
  /** 'auto' or a Live model id. */
  model: string;
  /** The mic picked in Settings ('' = automatic). */
  micId: string;
  /** The owner allows web search in Live voice. */
  searchAllowed?: boolean;
  /** Start with web search on. */
  search?: boolean;
  /** The models, voices and languages on offer (GET /api/ai/models). */
  voiceInfo?: VoiceInfo;
  /** The typed chat so far, so the call carries on from it. */
  context?: Array<{ role: 'user' | 'assistant'; text: string }>;
  /** The chat is incognito: no memory. */
  incognito?: boolean;
  /** Closed; `savedTo` names the chat the session was saved into, when it was. */
  onClose(savedTo: string | null): void;
  /** In the background: a small bar while the listener browses (LiveHost). */
  minimized?: boolean;
  onMinimize?(): void;
  onExpand?(): void;
}

const STATUS: Record<LiveState, string> = {
  connecting: 'Connecting…',
  listening: 'Listening',
  speaking: 'VinaX AI is speaking',
  ended: 'Ended',
};

function endMessage(reason: LiveEndReason, error?: string): string | null {
  if (reason === 'closed') return null;
  if (reason === 'time') return 'Live voice sessions last about ten minutes. Start another to keep talking.';
  if (reason === 'dropped') return 'The connection dropped. Start Live voice again to keep talking.';
  if (reason === 'mic') return micNotice((error ?? 'unsupported') as MicProblem);
  return error === 'unsupported' ? 'Live voice isn’t supported in this browser.' : voiceNotice(error ?? 'voice_unavailable');
}

export default function LiveView({ conversationId, parentMessageId, thinking, voice, model, micId, searchAllowed = false, search: searchAtStart = false, voiceInfo, context, incognito = false, onClose, minimized = false, onMinimize, onExpand }: LiveViewProps): ReactNode {
  const captionsOn = usePrefs((p) => p.liveCaptions);
  /** What the pickers show: the listener's choices, applied to the session as they change. */
  const [pick, setPick] = useState(() => ({ model, voice, language: usePrefs.getState().liveLanguage }));
  const [state, setState] = useState<LiveState>('connecting');
  const [captions, setCaptions] = useState({ user: '', assistant: '' });
  const [muted, setMuted] = useState(false);
  /** Muted by the page because music is playing (unmuting pauses it). */
  const [musicMuted, setMusicMuted] = useState(false);
  const musicPlaying = usePlayerStore((p) => p.isPlaying);
  /** What is being shown to VinaX AI: the camera or the screen (with its preview), and a note for a photo. */
  const [share, setShare] = useState<{ kind: ShareKind; stream: MediaStream } | null>(null);
  const [shareNote, setShareNote] = useState<string | null>(null);
  const frames = useRef<FrameShare | null>(null);
  const preview = useRef<HTMLVideoElement>(null);
  const photoInput = useRef<HTMLInputElement>(null);
  const [ended, setEnded] = useState<{ message: string | null } | null>(null);
  const [saving, setSaving] = useState(false);
  const [modelName, setModelName] = useState<string | null>(null);
  const [mic, setMic] = useState<{ label: string; silent: boolean } | null>(null);
  const [mics, setMics] = useState<MicDevice[] | null>(null);
  const [micError, setMicError] = useState<string | null>(null);
  const [search, setSearch] = useState(searchAtStart);
  const [web, setWeb] = useState<{ sources: SourcesInfo | null; searching: boolean }>({ sources: null, searching: false });
  /** Android app with the route plugin: where the voice plays. Null hides the speaker button. */
  const [route, setRoute] = useState<AudioRoute | null>(null);
  const [routeBusy, setRouteBusy] = useState(false);
  /** An Android app built before the route plugin: it cannot switch, so say how to get the button. */
  const [oldApp] = useState(() => isNativePlatform() && !audioRouteAvailable());
  const session = useRef<LiveSession | null>(null);
  const orb = useRef<HTMLSpanElement>(null);
  const endButton = useRef<HTMLButtonElement>(null);
  const closing = useRef(false);

  const save = async (s: LiveSession): Promise<string | null> => {
    const turns = s.transcript.turns();
    if (!turns.length || !s.model) return null;
    setSaving(true);
    try {
      const r = await saveLiveTranscript({ conversationId, ...(conversationId && parentMessageId ? { parentMessageId } : {}), model: s.model.id, turns });
      return r.conversationId;
    } catch {
      return null;
    } finally {
      setSaving(false);
    }
  };

  const close = async () => {
    if (closing.current) return;
    closing.current = true;
    const s = session.current;
    s?.stop();
    onClose(s ? await save(s) : null);
  };

  // Back closes the full-screen call; in the background it is left alone.
  useDismissOnBack(!minimized, () => void close());

  useEffect(() => {
    const back = document.activeElement as HTMLElement | null;
    endButton.current?.focus();
    const release = holdMusic('pause');
    const prefs = usePrefs.getState();
    const s = new LiveSession({
      thinking, voice: pick.voice, model: pick.model, micId, search: searchAtStart, speaker: prefs.liveSpeaker,
      language: pick.language, music: true, context, personal: personalOf(prefs), conversationId, incognito,
    }, {
      onState: (st) => {
        setState(st);
        if (s.model) setModelName(s.model.name);
        // The session may have started without search (a model that refused it).
        if (st === 'listening') setSearch(s.search);
      },
      onCaptions: setCaptions,
      onWeb: setWeb,
      onMic: (m) => {
        setMic(m);
        if (m.silent) void listMics().then(setMics);
      },
      onRoute: setRoute,
      onLevel: (level) => {
        orb.current?.style.setProperty('--vx-live-level', String(level));
      },
      onEnd: (reason, error) => {
        if (reason !== 'closed') setEnded({ message: endMessage(reason, error) });
      },
    });
    session.current = s;
    frames.current = new FrameShare((jpeg) => { s.sendFrame(jpeg); }, () => setShare(null));
    void s.start();
    return () => {
      frames.current?.stop();
      s.stop();
      release();
      back?.focus?.();
    };
    // One session per opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleMute = () => {
    const m = !muted;
    // Unmuting while music plays: the music pauses so VinaX AI hears the listener, not the song.
    if (!m && musicPlaying) {
      const p = usePlayerStore.getState();
      if (p.isPlaying) p.togglePlay();
    }
    setMusicMuted(false);
    setMuted(m);
    session.current?.setMuted(m);
  };

  // Music started during the call (VinaX AI played it, or the listener did): the mic is muted so the
  // song isn't taken for speech; when it stops, a mute the page made is lifted again.
  useEffect(() => {
    if (ended) return;
    if (musicPlaying && !muted) {
      setMusicMuted(true);
      setMuted(true);
      session.current?.setMuted(true);
    } else if (!musicPlaying && musicMuted) {
      setMusicMuted(false);
      setMuted(false);
      session.current?.setMuted(false);
    }
    // Only the music's state drives this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [musicPlaying]);

  /** Show VinaX AI the camera or the screen (again to stop). */
  const toggleShare = async (kind: ShareKind) => {
    const f = frames.current;
    if (!f) return;
    setShareNote(null);
    if (share?.kind === kind) { f.stop(); setShare(null); return; }
    try {
      await f.start(kind);
      if (f.stream) setShare({ kind, stream: f.stream });
    } catch {
      setShare(null);
      setShareNote(kind === 'camera' ? 'The camera couldn’t be opened. Check that VinaX may use it.' : 'Screen sharing didn’t start.');
    }
  };
  const flipCamera = async () => {
    try {
      await frames.current?.flip();
      if (frames.current?.stream) setShare({ kind: 'camera', stream: frames.current.stream });
    } catch {
      setShareNote('The other camera couldn’t be opened.');
    }
  };
  /** One photo for VinaX AI to look at. */
  const sendPhoto = async (file: File | undefined) => {
    if (!file) return;
    const jpeg = await photoFrame(file);
    const sent = !!jpeg && !!session.current?.sendFrame(jpeg);
    setShareNote(sent ? `VinaX AI can see “${file.name.slice(0, 40)}”. Ask about it.` : 'That photo couldn’t be sent. Try another picture.');
  };
  useEffect(() => {
    if (preview.current) preview.current.srcObject = share?.stream ?? null;
  }, [share, minimized]);
  useEffect(() => { if (ended) { frames.current?.stop(); setShare(null); } }, [ended]);

  /** Switch the model, the voice or the language: remembered, and the call reconnects with it. */
  const choose = (patch: Partial<typeof pick>) => {
    setPick((p) => ({ ...p, ...patch }));
    usePrefs.getState().set({
      ...(patch.model !== undefined ? { liveModel: patch.model } : {}),
      ...(patch.voice !== undefined ? { liveVoice: patch.voice } : {}),
      ...(patch.language !== undefined ? { liveLanguage: patch.language } : {}),
    });
    session.current?.setOptions(patch);
  };

  const models = voiceInfo?.liveModels ?? [];
  const voices = voiceInfo?.liveVoices ?? [];
  const languages = voiceInfo?.liveLanguages ?? [];

  const toggleSearch = () => {
    const on = !search;
    setSearch(on);
    usePrefs.getState().set({ liveSearch: on });
    void session.current?.setSearch(on);
  };

  const toggleSpeaker = async () => {
    const on = route !== 'speaker';
    setRouteBusy(true);
    try {
      const now = await session.current?.setSpeaker(on);
      // Remembered only when the switch took (a headset keeps its own route until switched).
      if (now === 'speaker' || now === 'earpiece') usePrefs.getState().set({ liveSpeaker: now === 'speaker' });
    } finally {
      setRouteBusy(false);
    }
  };

  const chooseMic = async () => {
    if (!mics) setMics(await listMics());
    else setMics(null);
  };
  const switchMic = async (deviceId: string) => {
    setMicError(null);
    try {
      await session.current?.switchMic(deviceId);
      usePrefs.getState().set({ micId: deviceId });
      setMics(null);
    } catch {
      setMicError('That microphone couldn’t be opened. Try another one.');
    }
  };
  const status = ended ? 'Live voice ended' : musicMuted ? 'Muted while music plays' : muted ? 'Muted' : web.searching && state !== 'connecting' ? 'Searching the web…' : STATUS[state];
  const orbClass = `vx-ai-live-orb is-${ended ? 'ended' : muted ? 'muted' : state}`;

  if (minimized) {
    return (
      <div className="vx-ai-live-mini" role="region" aria-label="Live voice">
        <button type="button" className="vx-ai-live-mini-main" onClick={onExpand} aria-label="Open Live voice">
          <span ref={orb} className={`${orbClass} is-mini`} aria-hidden>
            <span className="vx-ai-live-orb-colors" />
            <span className="vx-ai-live-orb-swirl" />
          </span>
          <span className="vx-ai-live-mini-text">
            <span className="vx-ai-live-mini-title">Live voice</span>
            <span className="vx-ai-live-mini-status" role="status">{status}</span>
          </span>
        </button>
        {!ended && (
          <button type="button" className={`vx-ai-icon-btn${muted ? ' is-on' : ''}`} onClick={toggleMute} aria-pressed={muted} aria-label={muted ? 'Unmute microphone' : 'Mute microphone'}>
            {muted ? <MicOffIcon className="w-5 h-5" /> : <MicIcon className="w-5 h-5" />}
          </button>
        )}
        <button type="button" className="vx-ai-live-mini-end" onClick={() => void close()} disabled={saving}>
          {saving ? 'Saving…' : ended ? 'Close' : 'End'}
        </button>
      </div>
    );
  }
  return (
    <div
      className="vx-ai-live"
      role="dialog"
      aria-modal="true"
      aria-labelledby="vx-ai-live-title"
      onKeyDown={(e) => {
        if (e.key === 'Escape') { e.stopPropagation(); void close(); }
        if (e.key === 'Tab') {
          const f = [...e.currentTarget.querySelectorAll<HTMLElement>('button:not([disabled]), select, a[href], iframe')];
          const i = f.indexOf(document.activeElement as HTMLElement);
          e.preventDefault();
          f[(i + (e.shiftKey ? -1 : 1) + f.length) % f.length]?.focus();
        }
      }}
    >
      <div className="vx-ai-live-top">
        <h2 id="vx-ai-live-title">Live voice</h2>
        {modelName && <span className="vx-ai-live-model">{modelName}</span>}
        {onMinimize && !ended && (
          <button type="button" className="vx-ai-icon-btn" onClick={onMinimize} aria-label="Keep talking while you browse" title="Keep talking while you browse VinaX">
            <MinimizeIcon className="w-5 h-5" />
          </button>
        )}
        <button type="button" className="vx-ai-icon-btn" onClick={() => void close()} aria-label="Close Live voice">
          <CloseIcon className="w-5 h-5" />
        </button>
      </div>
      {!ended && (models.length > 0 || voices.length > 0 || languages.length > 0) && (
        <div className="vx-ai-live-picks">
          {models.length > 0 && (
            <label className="vx-ai-live-pick">
              <span>Model</span>
              <select value={models.some((m) => m.id === pick.model) ? pick.model : 'auto'} onChange={(e) => choose({ model: e.target.value })}>
                <option value="auto">Auto</option>
                {models.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </label>
          )}
          {voices.length > 0 && (
            <label className="vx-ai-live-pick">
              <span>Voice</span>
              <select value={voices.includes(pick.voice) ? pick.voice : voices[0]} onChange={(e) => choose({ voice: e.target.value })}>
                {voices.map((v) => <option key={v} value={v}>{voiceLabel(v)}</option>)}
              </select>
            </label>
          )}
          {languages.length > 0 && (
            <label className="vx-ai-live-pick">
              <span>Language</span>
              <select value={languages.some((l) => l.code === pick.language) ? pick.language : 'auto'} onChange={(e) => choose({ language: e.target.value })}>
                <option value="auto">Match how I speak</option>
                {languages.map((l) => <option key={l.code} value={l.code}>{l.native === l.name ? l.name : `${l.name} · ${l.native}`}</option>)}
              </select>
            </label>
          )}
        </div>
      )}
      <div className="vx-ai-live-stage">
        <button
          type="button"
          className="vx-ai-live-orb-btn"
          onClick={() => session.current?.interrupt()}
          disabled={!!ended || state !== 'speaking'}
          aria-label="Stop VinaX AI talking"
          title={state === 'speaking' ? 'Tap to stop VinaX AI talking' : undefined}
        >
          <span ref={orb} className={orbClass} aria-hidden>
            <span className="vx-ai-live-orb-colors" />
            <span className="vx-ai-live-orb-swirl" />
            <span className="vx-ai-live-orb-shine" />
          </span>
        </button>
        <p className="vx-ai-live-status" role="status">{status}</p>
        {share && (
          <div className="vx-ai-live-preview">
            <video ref={preview} autoPlay muted playsInline aria-label={share.kind === 'camera' ? 'What your camera shows VinaX AI' : 'The screen you share with VinaX AI'} />
            {share.kind === 'camera' && (
              <button type="button" className="vx-ai-icon-btn" onClick={() => void flipCamera()} aria-label="Switch camera">
                <FlipIcon className="w-5 h-5" />
              </button>
            )}
          </div>
        )}
        {shareNote && <p className="vx-ai-live-note" role="status">{shareNote}</p>}
        {!ended && state === 'speaking' && !muted && <p className="vx-ai-live-hint">Tap the orb or start talking to cut in</p>}
        {ended?.message && <p className="vx-ai-live-note" role="alert">{ended.message}</p>}
        {!ended && mic?.silent && <p className="vx-ai-live-note" role="alert">{silentMicNotice(mic.label, 'Pick another microphone below.')}</p>}
        {!ended && mic && (
          <div className="vx-ai-live-mic">
            <button type="button" className="vx-ai-chip" onClick={() => void chooseMic()} aria-expanded={!!mics}>
              <MicIcon className="w-4 h-4" /> {mic.label || 'Microphone'}
            </button>
            {mics && (
              <select aria-label="Microphone" value="" onChange={(e) => { if (e.target.value) void switchMic(e.target.value); }}>
                <option value="">Use another microphone…</option>
                {mics.filter((d) => d.deviceId !== 'default' && d.deviceId !== 'communications').map((d) => (
                  <option key={d.deviceId} value={d.deviceId}>{cleanMicLabel(d.label) || 'Microphone'}{d.virtual ? ' (virtual)' : ''}</option>
                ))}
              </select>
            )}
            {micError && <p className="vx-ai-live-note" role="alert">{micError}</p>}
          </div>
        )}
        <div className="vx-ai-live-captions" aria-hidden={!!ended} hidden={!captionsOn}>
          {captions.user && <p className="vx-ai-live-you"><span className="sr-only">You: </span>{captions.user}</p>}
          {captions.assistant && <p className="vx-ai-live-ai"><span className="sr-only">VinaX AI: </span>{captions.assistant}</p>}
        </div>
        {web.sources && <div className="vx-ai-live-sources"><SourcesRow sources={web.sources} /></div>}
      </div>
      <div className="vx-ai-live-controls">
        {!ended && (
          <button type="button" className={`vx-ai-live-btn${muted ? ' is-on' : ''}`} onClick={toggleMute} aria-pressed={muted} aria-label={muted ? 'Unmute microphone' : 'Mute microphone'}>
            {muted ? <MicOffIcon className="w-6 h-6" /> : <MicIcon className="w-6 h-6" />}
          </button>
        )}
        {!ended && cameraSupported() && (
          <button
            type="button"
            className={`vx-ai-live-btn${share?.kind === 'camera' ? ' is-on' : ''}`}
            onClick={() => void toggleShare('camera')}
            disabled={state === 'connecting'}
            aria-pressed={share?.kind === 'camera'}
            aria-label="Camera"
            title={share?.kind === 'camera' ? 'VinaX AI sees your camera' : 'Show VinaX AI something with your camera'}
          >
            <VideoIcon className="w-6 h-6" />
          </button>
        )}
        {!ended && screenShareSupported() && (
          <button
            type="button"
            className={`vx-ai-live-btn${share?.kind === 'screen' ? ' is-on' : ''}`}
            onClick={() => void toggleShare('screen')}
            disabled={state === 'connecting'}
            aria-pressed={share?.kind === 'screen'}
            aria-label="Share screen"
            title={share?.kind === 'screen' ? 'VinaX AI sees your screen' : 'Show VinaX AI your screen'}
          >
            <ScreenIcon className="w-6 h-6" />
          </button>
        )}
        {!ended && (
          <>
            <button type="button" className="vx-ai-live-btn" onClick={() => photoInput.current?.click()} disabled={state === 'connecting'} aria-label="Show a photo" title="Show VinaX AI a photo">
              <ImageIcon className="w-6 h-6" />
            </button>
            <input ref={photoInput} type="file" accept="image/*" hidden onChange={(e) => { void sendPhoto(e.target.files?.[0]); e.target.value = ''; }} />
          </>
        )}
        {!ended && searchAllowed && (
          <button
            type="button"
            className={`vx-ai-live-btn${search ? ' is-on' : ''}`}
            onClick={toggleSearch}
            disabled={state === 'connecting'}
            aria-pressed={search}
            aria-label="Web search"
            title={search ? 'Web search is on' : 'Web search is off'}
          >
            <GlobeSmallIcon className="w-6 h-6" />
          </button>
        )}
        {!ended && (
          <button
            type="button"
            className={`vx-ai-live-btn${captionsOn ? ' is-on' : ''}`}
            onClick={() => usePrefs.getState().set({ liveCaptions: !captionsOn })}
            aria-pressed={captionsOn}
            aria-label="Captions"
            title={captionsOn ? 'Captions are on' : 'Captions are off'}
          >
            <CaptionsIcon className="w-6 h-6" />
          </button>
        )}
        {!ended && route && (
          <button
            type="button"
            className={`vx-ai-live-btn${route === 'speaker' ? ' is-on' : ''}`}
            onClick={() => void toggleSpeaker()}
            disabled={routeBusy}
            aria-pressed={route === 'speaker'}
            aria-label="Loudspeaker"
            title={route === 'speaker' ? 'Playing on the loudspeaker' : route === 'earpiece' ? 'Playing on the earpiece' : 'Playing on your headset'}
          >
            <SpeakerIcon className="w-6 h-6" />
          </button>
        )}
        <button ref={endButton} type="button" className="vx-ai-live-btn is-end" onClick={() => void close()} disabled={saving}>
          {saving ? 'Saving…' : ended ? 'Close' : 'End'}
        </button>
      </div>
      <p className="vx-ai-live-foot">
        Your voice{share ? ` and your ${share.kind}` : ''} {share ? 'are' : 'is'} sent to Google Gemini to answer{search ? ', and it may search the web with Google for what you ask' : ''}. What you both say is saved in this chat.
        {oldApp && ' Update the VinaX app to switch between the loudspeaker and the earpiece.'}
      </p>
    </div>
  );
}

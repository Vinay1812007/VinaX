/**
 * VinaX AI — Live voice: a full-screen view for talking with VinaX AI out
 * loud. Music pauses while it is open. Captions show what each side says;
 * when it closes, the conversation is saved into the chat as ordinary
 * messages (POST /api/ai/live-transcript) and the chat reloads to show it.
 * With web search on, the sources of the latest reply show under the
 * captions; the globe button switches search (Live voice reconnects).
 * Loaded on demand, only when someone opens it.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useDismissOnBack } from '@/hooks/useDismissOnBack';
import { saveLiveTranscript, voiceNotice } from '../api';
import { cleanMicLabel, listMics, micNotice, silentMicNotice, type MicDevice, type MicProblem } from '../mic';
import { usePrefs } from '../prefs';
import { holdMusic } from '../musicHold';
import { CloseIcon, GlobeSmallIcon, MicIcon, MicOffIcon, SpeakerIcon } from '../icons';
import { isNativePlatform } from '@/services/native';
import { audioRouteAvailable, type AudioRoute } from './audioRoute';
import { SourcesRow } from '../Sources';
import type { SourcesInfo } from '../types';
import { LiveSession, type LiveEndReason, type LiveState } from './liveSession';

interface Props {
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
  /** Closed; `savedTo` names the chat the session was saved into, when it was. */
  onClose(savedTo: string | null): void;
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

export default function LiveView({ conversationId, parentMessageId, thinking, voice, model, micId, searchAllowed = false, search: searchAtStart = false, onClose }: Props): ReactNode {
  const [state, setState] = useState<LiveState>('connecting');
  const [captions, setCaptions] = useState({ user: '', assistant: '' });
  const [muted, setMuted] = useState(false);
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
  const orb = useRef<HTMLDivElement>(null);
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

  useDismissOnBack(true, () => void close());

  useEffect(() => {
    const back = document.activeElement as HTMLElement | null;
    endButton.current?.focus();
    const release = holdMusic('pause');
    const s = new LiveSession({ thinking, voice, model, micId, search: searchAtStart, speaker: usePrefs.getState().liveSpeaker }, {
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
    void s.start();
    return () => {
      s.stop();
      release();
      back?.focus?.();
    };
    // One session per opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleMute = () => {
    const m = !muted;
    setMuted(m);
    session.current?.setMuted(m);
  };

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
  const status = ended ? 'Live voice ended' : muted ? 'Muted' : web.searching && state !== 'connecting' ? 'Searching the web…' : STATUS[state];
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
        <button type="button" className="vx-ai-icon-btn" onClick={() => void close()} aria-label="Close Live voice">
          <CloseIcon className="w-5 h-5" />
        </button>
      </div>
      <div className="vx-ai-live-stage">
        <div ref={orb} className={`vx-ai-live-orb is-${ended ? 'ended' : muted ? 'muted' : state}`} aria-hidden />
        <p className="vx-ai-live-status" role="status">{status}</p>
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
        <div className="vx-ai-live-captions" aria-hidden={!!ended}>
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
        Your voice is sent to Google Gemini to answer{search ? ', and it may search the web with Google for what you ask' : ''}. What you both say is saved in this chat.
        {oldApp && ' Update the VinaX app to switch between the loudspeaker and the earpiece.'}
      </p>
    </div>
  );
}

/**
 * VinaX AI — Live voice: a full-screen view for talking with VinaX AI out
 * loud. Music pauses while it is open. Captions show what each side says;
 * when it closes, the conversation is saved into the chat as ordinary
 * messages (POST /api/ai/live-transcript) and the chat reloads to show it.
 * Loaded on demand, only when someone opens it.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useDismissOnBack } from '@/hooks/useDismissOnBack';
import { saveLiveTranscript, voiceNotice } from '../api';
import { micNotice, type MicProblem } from '../mic';
import { holdMusic } from '../musicHold';
import { CloseIcon, MicIcon, MicOffIcon } from '../icons';
import { LiveSession, type LiveEndReason, type LiveState } from './liveSession';

interface Props {
  conversationId: string | null;
  /** The message the session's first turn hangs on (the chat's current leaf). */
  parentMessageId: string | null;
  thinking: boolean;
  voice: string;
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

export default function LiveView({ conversationId, parentMessageId, thinking, voice, onClose }: Props): ReactNode {
  const [state, setState] = useState<LiveState>('connecting');
  const [captions, setCaptions] = useState({ user: '', assistant: '' });
  const [muted, setMuted] = useState(false);
  const [ended, setEnded] = useState<{ message: string | null } | null>(null);
  const [saving, setSaving] = useState(false);
  const [modelName, setModelName] = useState<string | null>(null);
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
    const s = new LiveSession({ thinking, voice }, {
      onState: (st) => {
        setState(st);
        if (s.model) setModelName(s.model.name);
      },
      onCaptions: setCaptions,
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

  const status = ended ? 'Live voice ended' : muted ? 'Muted' : STATUS[state];
  return (
    <div
      className="vx-ai-live"
      role="dialog"
      aria-modal="true"
      aria-labelledby="vx-ai-live-title"
      onKeyDown={(e) => {
        if (e.key === 'Escape') { e.stopPropagation(); void close(); }
        if (e.key === 'Tab') {
          const f = [...e.currentTarget.querySelectorAll<HTMLElement>('button:not([disabled])')];
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
        <div className="vx-ai-live-captions" aria-hidden={!!ended}>
          {captions.user && <p className="vx-ai-live-you"><span className="sr-only">You: </span>{captions.user}</p>}
          {captions.assistant && <p className="vx-ai-live-ai"><span className="sr-only">VinaX AI: </span>{captions.assistant}</p>}
        </div>
      </div>
      <div className="vx-ai-live-controls">
        {!ended && (
          <button type="button" className={`vx-ai-live-btn${muted ? ' is-on' : ''}`} onClick={toggleMute} aria-pressed={muted} aria-label={muted ? 'Unmute microphone' : 'Mute microphone'}>
            {muted ? <MicOffIcon className="w-6 h-6" /> : <MicIcon className="w-6 h-6" />}
          </button>
        )}
        <button ref={endButton} type="button" className="vx-ai-live-btn is-end" onClick={() => void close()} disabled={saving}>
          {saving ? 'Saving…' : ended ? 'Close' : 'End'}
        </button>
      </div>
      <p className="vx-ai-live-foot">Your voice is sent to Google Gemini to answer. What you both say is saved in this chat.</p>
    </div>
  );
}

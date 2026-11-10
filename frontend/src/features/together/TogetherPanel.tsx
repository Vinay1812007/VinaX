import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { UsersIcon } from '@/components/Icons';
import { useCurrentSong } from '@/store/playerStore';
import { useTogether } from '@/services/together/session';
import { toast } from '@/store/toastStore';
import { shareLink } from '@/utils/share';
import { leaveSession, startHosting } from './engine';
import { JoinRoom } from './JoinRoom';
import { OpenInApp } from './OpenInApp';
import { useInviteQr } from './useInviteQr';
import '@/styles/pages/together.css';

/**
 * 1.13 — Listen Together inside the player: the "Together" tab beside Up
 * next, Lyrics and Credits. It used to be one line in the ⋮ menu. From here
 * a listener starts a room on the song that is playing, joins one by code or
 * by scanning the host's QR, and — once live — sees the code, the QR, who is
 * listening and the way into the full room (chat, requests, reactions).
 */
export default function TogetherPanel(): ReactNode {
  const mode = useTogether((s) => s.mode);
  const code = useTogether((s) => s.code);
  const status = useTogether((s) => s.status);
  const hostName = useTogether((s) => s.hostName);
  const count = useTogether((s) => Math.max(s.listenerCount, s.members.length, s.names.length, 1));
  const current = useCurrentSong();
  const [starting, setStarting] = useState(false);
  const qr = useInviteQr(mode === 'idle' ? '' : code, 320);

  if (mode === 'idle') {
    return (
      <div className="vx-lt vx-ltp">
        <div className="vx-ltp-hero">
          <span className="vx-ltp-mark" aria-hidden>
            <UsersIcon className="w-6 h-6" />
          </span>
          <div className="min-w-0">
            <h3 className="vx-ltp-title">Listen together</h3>
            <p className="vx-ltp-lede">The same song, at the same second, on every phone in the room.</p>
          </div>
        </div>
        <button
          type="button"
          className="vx-lt-cta"
          disabled={starting}
          onClick={() => {
            setStarting(true);
            void startHosting(current ?? null).then((r) => {
              setStarting(false);
              if (!r.ok) toast(r.message);
            });
          }}
        >
          {starting ? 'Starting…' : current ? 'Start a room with this song' : 'Start a room'}
        </button>
        <p className="vx-ltp-or">or join a friend’s room</p>
        <JoinRoom inputId="vx-ltp-code" disabled={starting} />
        <OpenInApp />
      </div>
    );
  }

  const live = status === 'live';
  return (
    <div className="vx-lt vx-ltp is-live">
      <p className="vx-lt-status" data-status={status} role="status">
        <span className="vx-lt-dot" aria-hidden />
        {status === 'connecting' ? 'Connecting…' : status === 'reconnecting' ? 'Reconnecting…' : mode === 'host' ? 'Live · you’re hosting' : live ? `Live · with ${hostName ?? 'the host'}` : `${hostName ?? 'The host'} went quiet`}
      </p>
      <div className="vx-ltp-room">
        <div className="min-w-0">
          <p className="vx-lt-kicker">Room code</p>
          <p className="vx-lt-code">{code}</p>
          <p className="vx-ltp-count tabular-nums">{count} listening</p>
        </div>
        {qr && <img src={qr} alt={`QR code to join room ${code}`} className="vx-lt-qr vx-ltp-qr" />}
      </div>
      <p className="vx-ltp-lede">Friends scan the QR from VinaX — Listen together › Scan — or with their phone’s camera.</p>
      <div className="vx-ltp-actions">
        <button
          type="button"
          className="vx-lt-cta is-sm"
          onClick={() => void shareLink(`/together?code=${code}`, 'Listen with me on VinaX').then((r) => r !== 'failed' && toast(r === 'copied' ? 'Invite copied' : 'Invite shared'))}
        >
          Share invite
        </button>
        <Link to="/together" className="vx-ltp-pill">Open the room</Link>
        <button type="button" className="vx-ltp-pill is-danger" onClick={leaveSession}>
          {mode === 'host' ? 'End for everyone' : 'Leave'}
        </button>
      </div>
      {mode === 'guest' && <OpenInApp code={code} />}
    </div>
  );
}

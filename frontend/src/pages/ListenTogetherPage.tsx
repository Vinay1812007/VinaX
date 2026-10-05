import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { usePageTitle } from '@/hooks/usePageTitle';
import { ArtistAvatar } from '@/features/stats/artwork';
import { useCurrentSong } from '@/store/playerStore';
import { REACTION_EMOJI } from '@/services/together';
import { useTogether } from '@/services/together/session';
import { addSong, joinSession, leaveSession, react, startHosting, tapToListen } from '@/features/together/engine';
import { searchSongs } from '@/services/api';
import { bestImage } from '@/utils/images';
import type { Song } from '@/types';
import { shareLink } from '@/utils/share';
import { toast } from '@/store/toastStore';
import { PlusIcon, UsersIcon } from '@/components/Icons';
import '@/styles/pages/secondary.css';
import '@/styles/pages/together.css';

function AddSong({ label }: { label: string }): ReactNode {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Song[]>([]);
  const [sending, setSending] = useState<string | null>(null);
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setResults([]);
      return;
    }
    const t = window.setTimeout(() => {
      searchSongs(term, 6).then(setResults).catch(() => setResults([]));
    }, 350);
    return () => window.clearTimeout(t);
  }, [q]);
  return (
    <section className="vx-lt-block" aria-label={label}>
      <h2 className="vx-lt-h2">{label}</h2>
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search a song for everyone"
        aria-label={label}
        type="search"
        className="vx-sec-field"
      />
      {results.length > 0 && (
        <ul className="vx-group mt-3">
          {results.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                aria-label={`Add ${s.title}`}
                disabled={sending === s.id}
                onClick={() => {
                  setSending(s.id);
                  void addSong(s).then((msg) => {
                    toast(msg);
                    setSending(null);
                    setQ('');
                    setResults([]);
                  });
                }}
                className="vx-row"
              >
                <img src={bestImage(s.images, 100)} alt="" className="vx-row-art" loading="lazy" />
                <span className="vx-row-main">
                  <span className="vx-row-label truncate-1">{s.title}</span>
                  <span className="vx-row-hint truncate-1">{s.subtitle}</span>
                </span>
                <PlusIcon className="w-5 h-5 text-ink-300 shrink-0" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function SyncBadge(): ReactNode {
  const mode = useTogether((s) => s.mode);
  const status = useTogether((s) => s.status);
  const drift = useTogether((s) => s.drift);
  const text =
    status === 'connecting'
      ? 'Connecting…'
      : status === 'reconnecting'
        ? 'Reconnecting…'
        : status === 'host-away'
          ? 'Host went quiet — still playing along'
          : mode === 'host'
            ? 'Live · you’re hosting'
            : drift === null
              ? 'Live · syncing…'
              : Math.abs(drift) < 0.6
                ? 'Live · in sync'
                : 'Live · catching up…';
  return (
    <p className="vx-lt-status" data-status={status} role="status">
      <span className="vx-lt-dot" aria-hidden />
      {text}
    </p>
  );
}

function Idle(): ReactNode {
  const [params, setParams] = useSearchParams();
  const current = useCurrentSong();
  const [joinCode, setJoinCode] = useState((params.get('code') ?? '').toUpperCase());
  const [busy, setBusy] = useState<'host' | 'join' | null>(null);

  const join = async (code: string): Promise<void> => {
    setBusy('join');
    const r = await joinSession(code);
    setBusy(null);
    if (!r.ok) toast(r.message);
  };

  // Arriving via an invite link (?code=…) joins by itself — once. If the
  // browser holds audio until a tap, the live view shows "Tap to listen".
  const autoJoined = useRef(false);
  useEffect(() => {
    const linkCode = (params.get('code') ?? '').trim();
    if (autoJoined.current || !linkCode) return;
    autoJoined.current = true;
    // Drop ?code from the address: leaving later must not re-join on its own.
    setParams({}, { replace: true });
    void join(linkCode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  return (
    <div className="vx-sec vx-lt">
      <header className="vx-lt-hero">
        <span className="vx-lt-hero-mark" aria-hidden>
          <UsersIcon className="w-6 h-6" />
        </span>
        <h1 className="vx-lt-title">Listen together</h1>
        <p className="vx-lt-lede">The same song, at the same second, on every phone in the room. Free — no sign-up, no app needed.</p>
      </header>

      <div className="vx-lt-cards">
        <section className="vx-lt-card is-host" aria-labelledby="vx-lt-start">
          <h2 id="vx-lt-start" className="vx-lt-h2">Host a session</h2>
          <p className="vx-lt-note">You pick the music. Everyone who joins hears exactly what you play.</p>
          <ol className="vx-lt-steps">
            <li>Start — you get a room code and a QR</li>
            <li>Share the link or let friends scan</li>
            <li>Play as usual, from any page</li>
          </ol>
          <button
            type="button"
            disabled={busy !== null}
            className="vx-lt-cta"
            onClick={() => {
              setBusy('host');
              void startHosting(current ?? null).then((r) => {
                setBusy(null);
                if (!r.ok) toast(r.message);
              });
            }}
          >
            {busy === 'host' ? 'Starting…' : 'Start a session'}
          </button>
        </section>

        <section className="vx-lt-card" aria-labelledby="vx-lt-join">
          <h2 id="vx-lt-join" className="vx-lt-h2">Join a session</h2>
          <p className="vx-lt-note">Type the code your host shared. An invite link joins by itself.</p>
          <label className="vx-label" htmlFor="vx-lt-code">Room code</label>
          <div className="flex gap-2">
            <input
              id="vx-lt-code"
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void join(joinCode);
              }}
              placeholder="ABC123"
              maxLength={8}
              autoCapitalize="characters"
              autoCorrect="off"
              autoComplete="off"
              spellCheck={false}
              className="vx-lt-code-input"
            />
            <button type="button" onClick={() => void join(joinCode)} disabled={busy !== null} className="vx-lt-join">
              {busy === 'join' ? 'Joining…' : 'Join'}
            </button>
          </div>
          <p className="vx-lt-foot">Your player follows the host. Songs you add join the shared queue.</p>
        </section>
      </div>
    </div>
  );
}

function Live(): ReactNode {
  const mode = useTogether((s) => s.mode);
  const code = useTogether((s) => s.code);
  const members = useTogether((s) => s.members);
  const listenerCount = useTogether((s) => s.listenerCount);
  const hostName = useTogether((s) => s.hostName);
  const queue = useTogether((s) => s.queue);
  const floats = useTogether((s) => s.floats);
  const needsTap = useTogether((s) => s.needsTap);
  const current = useCurrentSong();
  const inviteLink = `/together?code=${code}`;

  // A QR of the invite link, so a friend in the room joins by pointing their
  // camera instead of typing a code. Generated locally.
  const [qr, setQr] = useState('');
  useEffect(() => {
    if (mode !== 'host' || !code) return;
    let alive = true;
    void import('qrcode')
      .then(({ toDataURL }) =>
        toDataURL(`${window.location.origin}${inviteLink}`, { margin: 1, width: 240, errorCorrectionLevel: 'M' }),
      )
      .then((url) => {
        if (alive) setQr(url);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [mode, code, inviteLink]);

  const art = current ? bestImage(current.images, 500) : '';
  const people = members.length ? members : ['You'];
  return (
    <div className="vx-sec is-narrow vx-lt is-live">
      <section className="vx-lt-room" aria-label="Room" style={art ? { ['--lt-art' as string]: `url("${art}")` } : undefined}>
        <div aria-hidden className="vx-lt-floats">
          {floats.map((f) => (
            <span key={f.id} className="vx-react" style={{ left: `${f.left}%` }}>{f.e}</span>
          ))}
        </div>
        <SyncBadge />
        <div className="vx-lt-room-main">
          {current ? (
            <img src={art} alt="" className="vx-lt-art" />
          ) : (
            <span className="vx-lt-art is-empty" aria-hidden><UsersIcon className="w-8 h-8" /></span>
          )}
          <div className="min-w-0">
            <p className="vx-lt-kicker">{mode === 'host' ? 'Everyone hears' : `Playing with ${hostName ?? 'the host'}`}</p>
            <p className="vx-lt-song truncate-1">{current?.title ?? (mode === 'host' ? 'Play anything to start' : 'Waiting for the host…')}</p>
            {current && <p className="vx-lt-artist truncate-1">{current.subtitle}</p>}
          </div>
        </div>

        {needsTap && (
          <button type="button" className="vx-lt-cta vx-lt-tap" onClick={tapToListen}>
            Tap to start listening
          </button>
        )}

        <div className="vx-lt-code-row">
          <div>
            <p className="vx-lt-kicker">Room code</p>
            <p className="vx-lt-code">{code}</p>
          </div>
          {mode === 'host' && qr && <img src={qr} alt={`QR code to join room ${code}`} className="vx-lt-qr" />}
        </div>
        {mode === 'host' && (
          <div className="vx-lt-actions">
            <button
              type="button"
              onClick={() => void shareLink(inviteLink, 'Listen with me on VinaX').then((r) => toast(r === 'copied' ? 'Invite copied' : 'Invite shared'))}
              className="vx-lt-cta is-sm"
            >
              Share invite
            </button>
            <button type="button" onClick={() => void navigator.clipboard?.writeText(code).then(() => toast('Code copied'))} className="vx-sec-pill">
              Copy code
            </button>
          </div>
        )}
        <div className="vx-lt-reacts" role="group" aria-label="React to the music">
          {REACTION_EMOJI.map((e) => (
            <button key={e} type="button" onClick={() => react(e)} aria-label={`React ${e}`} className="vx-react-btn">
              {e}
            </button>
          ))}
        </div>
      </section>

      <AddSong label={mode === 'host' ? 'Add to the queue' : 'Add a song for everyone'} />

      {queue.length > 0 && (
        <section className="vx-lt-block" aria-label="Up next">
          <h2 className="vx-lt-h2">Up next</h2>
          <ul className="vx-group">
            {queue.map((t, i) => (
              <li key={`${t.song.id}-${i}`} className="vx-row">
                <img src={bestImage(t.song.images, 100)} alt="" className="vx-row-art" loading="lazy" />
                <span className="vx-row-main">
                  <span className="vx-row-label truncate-1">{t.song.title}</span>
                  <span className="vx-row-hint truncate-1">{t.by ? `Added by ${t.by}` : t.song.subtitle}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="vx-lt-block" aria-labelledby="vx-lt-people">
        <h2 id="vx-lt-people" className="vx-lt-h2 tabular-nums">{Math.max(listenerCount, members.length, 1)} listening</h2>
        {/* Names render only when the server shared them (the host's view);
            guests see the honest count above — never each other's names. */}
        {mode === 'host' && (
          <ul className="vx-people">
            {people.map((m, i) => (
              <li key={`${m}-${i}`} className="vx-person">
                <ArtistAvatar name={m} size={36} />
                {m}
              </li>
            ))}
          </ul>
        )}
        <p className="vx-lt-foot">
          {mode === 'host'
            ? 'Play, pause, seek and skip as usual — from any page. Everyone follows you.'
            : 'The host controls playback; your player follows by itself, even while you browse other pages.'}
        </p>
      </section>

      <button type="button" onClick={leaveSession} className="vx-sec-pill is-danger">
        {mode === 'host' ? 'End for everyone' : 'Leave session'}
      </button>
    </div>
  );
}

export default function ListenTogetherPage(): ReactNode {
  usePageTitle('Listen Together');
  const mode = useTogether((s) => s.mode);
  return mode === 'idle' ? <Idle /> : <Live />;
}

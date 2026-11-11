import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { usePageTitle } from '@/hooks/usePageTitle';
import { ArtistAvatar } from '@/features/stats/artwork';
import { useCurrentSong } from '@/store/playerStore';
import { REACTION_EMOJI } from '@/services/together';
import { useTogether } from '@/services/together/session';
import { addSong, getTrimMs, joinSession, leaveSession, playNow, react, setTrimMs, startHosting, tapToListen, TRIM_MAX_MS, voteToSkip } from '@/features/together/engine';
import { Chat } from '@/features/together/Chat';
import { ENERGY_FULL, useRoom } from '@/features/together/room';
import { JoinRoom } from '@/features/together/JoinRoom';
import { OpenInApp } from '@/features/together/OpenInApp';
import { useInviteQr } from '@/features/together/useInviteQr';
import { useLibraryStore } from '@/store/libraryStore';
import { searchSongs } from '@/services/api';
import { bestImage } from '@/utils/images';
import type { Song } from '@/types';
import { shareLink } from '@/utils/share';
import { toast } from '@/store/toastStore';
import { useTutorialStore } from '@/store/tutorialStore';
import { KEYS } from '@/constants/storage-keys';
import { getLocal, setLocal } from '@/services/storage/local';
import { PlusIcon, UsersIcon } from '@/components/Icons';
import '@/styles/pages/secondary.css';
import '@/styles/pages/together.css';

/**
 * 1.12.11 — a guest's fine-tune. The sync lines up what the two players are
 * playing; how long each phone's speaker (or a Bluetooth one) then takes to
 * sound differs from device to device and cannot be measured from here. So
 * each device can be set a little earlier or later by ear, once; it is kept.
 */
const TRIM_STEP_MS = 10;
function FineTune(): ReactNode {
  const [ms, setMs] = useState(getTrimMs);
  const move = (by: number) => setMs(setTrimMs(ms + by));
  return (
    <div className="vx-lt-trim" role="group" aria-label="Fine-tune this phone">
      <div className="min-w-0">
        <p className="vx-lt-kicker">Fine-tune this phone</p>
        <p className="vx-lt-trim-hint">
          {ms === 0
            ? 'If this phone sounds late next to the host, tap Earlier. If it sounds early, tap Later.'
            : ms > 0
              ? `This phone plays ${ms} ms earlier. Kept for next time.`
              : `This phone plays ${-ms} ms later. Kept for next time.`}
        </p>
      </div>
      <div className="vx-lt-trim-row">
        <button type="button" className="vx-sec-pill" onClick={() => move(-TRIM_STEP_MS)} disabled={ms <= -TRIM_MAX_MS} aria-label={`Play this phone ${TRIM_STEP_MS} milliseconds later`}>
          Later
        </button>
        <output className="vx-lt-trim-value" aria-live="polite">{ms > 0 ? `+${ms}` : ms} ms</output>
        <button type="button" className="vx-sec-pill" onClick={() => move(TRIM_STEP_MS)} disabled={ms >= TRIM_MAX_MS} aria-label={`Play this phone ${TRIM_STEP_MS} milliseconds earlier`}>
          Earlier
        </button>
        {ms !== 0 && (
          <button type="button" className="vx-sec-pill" onClick={() => setMs(setTrimMs(0))}>
            Reset
          </button>
        )}
      </div>
    </div>
  );
}

/** Starts a guided tour (the runner and its steps are a lazy chunk). */
const startTour = (id: string) => useTutorialStore.getState().start(id);

/**
 * 1.12.12 — the introduction a first-time visitor gets: what the tour is and
 * a way into it. It leaves for good once the tour has been finished or "Not
 * now" was tapped; from then on the hero has a small "How it works" button.
 * Not shown to someone arriving through an invite link: they are on their way
 * into a room.
 */
function Intro({ onClose }: { onClose: () => void }): ReactNode {
  return (
    <section className="vx-lt-intro" aria-labelledby="vx-lt-intro">
      <div className="min-w-0">
        <p className="vx-lt-kicker">New here?</p>
        <h2 id="vx-lt-intro" className="vx-lt-h2">Take the one-minute tour</h2>
        <p className="vx-lt-intro-text">It points at the real buttons: how to host a room, how friends get in, and how to join one.</p>
      </div>
      <div className="vx-lt-intro-row">
        <button type="button" className="vx-lt-cta is-sm" onClick={() => startTour('listen-together')}>Show me how</button>
        <button type="button" className="vx-sec-pill" onClick={onClose}>Not now</button>
      </div>
    </section>
  );
}

function AddSong({ label, note }: { label: string; note?: string }): ReactNode {
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
      {note && <p className="vx-lt-note">{note}</p>}
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search a song for everyone"
        aria-label={label}
        data-tour="lt-add"
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
              : Math.abs(drift) < 0.1
                ? 'Live · in sync'
                : 'Live · catching up…';
  // 1.13 — the live line is up: what the host does is heard here at once.
  const online = useRoom((s) => s.online);
  return (
    <p className="vx-lt-status" data-status={status} role="status" data-tour="lt-status">
      <span className="vx-lt-dot" aria-hidden />
      {text}
      {online && status === 'live' && <span className="vx-lt-instant">Instant</span>}
    </p>
  );
}

/**
 * 1.13 — the room's energy. Every reaction anyone sends fills it a little and
 * it fades when the room goes quiet; fill it together and the whole room goes
 * off: everyone's emoji, across every screen, at the same moment.
 */
function Energy(): ReactNode {
  const energy = useRoom((s) => s.energy);
  const bursting = useRoom((s) => s.bursting);
  return (
    <div className="vx-lt-energy" data-full={bursting ? 'true' : undefined}>
      <div className="vx-lt-energy-top">
        <span className="vx-lt-kicker">Room energy</span>
        <span className="vx-lt-energy-hint">{bursting ? 'The room went off!' : energy > 0 ? 'Keep them coming' : 'React together to set the room off'}</span>
      </div>
      <div className="vx-lt-energy-bar" role="meter" aria-label="Room energy" aria-valuemin={0} aria-valuemax={ENERGY_FULL} aria-valuenow={bursting ? ENERGY_FULL : energy}>
        <i style={{ width: `${bursting ? 100 : (energy / ENERGY_FULL) * 100}%` }} />
      </div>
    </div>
  );
}

function Idle(): ReactNode {
  const [params, setParams] = useSearchParams();
  const current = useCurrentSong();
  const [linkCode] = useState(() => (params.get('code') ?? '').toUpperCase());
  const [busy, setBusy] = useState<'host' | 'join' | null>(null);
  const toured = useTutorialStore((s) => s.done.includes('listen-together'));
  const [introClosed, setIntroClosed] = useState(() => getLocal<boolean>(KEYS.togetherIntro, false));
  const offerTour = !toured && !introClosed && !linkCode;
  const closeIntro = () => {
    setLocal(KEYS.togetherIntro, true);
    setIntroClosed(true);
  };

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
        <p className="vx-lt-lede">The same song, at the same second, on every phone in the room. Free — no app needed.</p>
        {/* One way into the tour at a time: the introduction below, or this button once it is gone. */}
        {!offerTour && (
          <button type="button" className="vx-sec-pill vx-lt-how" onClick={() => startTour('listen-together')}>
            {toured ? 'Replay the tour' : 'How it works'}
          </button>
        )}
      </header>

      {offerTour && <Intro onClose={closeIntro} />}

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
          <p className="vx-lt-note">Type the code your host shared, or scan their QR. An invite link joins by itself.</p>
          <label className="vx-label" htmlFor="vx-lt-code">Room code</label>
          {/* 1.13 — type the code or scan the host's QR without leaving VinaX. */}
          <JoinRoom initialCode={linkCode} disabled={busy !== null} />
          <p className="vx-lt-foot">Your player follows the host. Songs you add join the shared queue.</p>
        </section>
      </div>
      {/* 1.13 — on an Android phone's browser: carry on in the app. */}
      <OpenInApp code={linkCode || undefined} />
    </div>
  );
}

function Live(): ReactNode {
  const mode = useTogether((s) => s.mode);
  const code = useTogether((s) => s.code);
  const members = useTogether((s) => s.members);
  const names = useTogether((s) => s.names);
  const skipVotes = useTogether((s) => s.skipVotes);
  const played = useTogether((s) => s.played);
  const listenerCount = useTogether((s) => s.listenerCount);
  const hostName = useTogether((s) => s.hostName);
  const roomToured = useTutorialStore((s) => s.done.includes('together-room'));
  const saveSession = () => {
    if (!played.length) { toast('Nothing has played yet'); return; }
    const lib = useLibraryStore.getState();
    const cid = lib.createCollection(`Listen together · ${new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`);
    if (!cid) return;
    lib.addManyToCollection(cid, played);
    toast(`Saved ${played.length} song${played.length === 1 ? '' : 's'} as a playlist`);
  };
  const queue = useTogether((s) => s.queue);
  const needsTap = useTogether((s) => s.needsTap);
  const hostSong = useTogether((s) => s.hostSong);
  const unplayable = useTogether((s) => s.unplayable);
  const playing = useCurrentSong();
  // A guest sees what the HOST is playing, also in the moment before this
  // device has fetched the song, and when it cannot get it at all.
  const current = mode === 'guest' && hostSong ? hostSong : playing;
  const missing = mode === 'guest' && !!hostSong && unplayable === hostSong.id;
  const inviteLink = `/together?code=${code}`;

  // A QR of the invite link, so a friend in the room joins by pointing their
  // camera (or VinaX's own scanner) instead of typing a code. Drawn on the
  // device. 1.13 — guests see it too, so anyone in the room can bring one more.
  const qr = useInviteQr(code);

  const art = current ? bestImage(current.images, 500) : '';
  const people = members.length ? members : ['You'];
  return (
    <div className="vx-sec is-narrow vx-lt is-live">
      <section className="vx-lt-room" aria-label="Room" style={art ? { ['--lt-art' as string]: `url("${art}")` } : undefined}>
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
            {current && <p className="vx-lt-artist truncate-1">{missing ? 'Not available on this device — the next song will play' : current.subtitle}</p>}
          </div>
        </div>

        {needsTap && (
          <button type="button" className="vx-lt-cta vx-lt-tap" onClick={tapToListen}>
            Tap to start listening
          </button>
        )}

        <div className="vx-lt-code-row" data-tour="lt-code">
          <div>
            <p className="vx-lt-kicker">Room code</p>
            <p className="vx-lt-code">{code}</p>
          </div>
          {qr && <img src={qr} alt={`QR code to join room ${code}`} className="vx-lt-qr" />}
        </div>
        {mode === 'guest' && <FineTune />}
        {mode === 'host' && (
          <div className="vx-lt-actions" data-tour="lt-invite">
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
          {/* 15.0 — vote to skip: the host skips outright; guests vote, and the song moves on past half the room. */}
          <button type="button" onClick={() => void voteToSkip()} className="vx-react-btn is-skip" aria-label={mode === 'host' ? 'Skip this song' : 'Vote to skip this song'} title={mode === 'host' ? 'Skip' : 'Vote to skip'}>
            ⏭{skipVotes > 0 && <span className="vx-react-count">{skipVotes}</span>}
          </button>
        </div>
        <Energy />
      </section>

      {/* 1.12.12 — a tour of this room's real controls, offered until it has been taken. */}
      <div className="vx-lt-around" data-new={roomToured ? undefined : 'true'}>
        {!roomToured && <p className="vx-lt-around-text">First time in a room? A one-minute tour points at everything here. The music keeps playing.</p>}
        <button type="button" className="vx-sec-pill" onClick={() => startTour('together-room')}>
          {roomToured ? 'Replay the room tour' : 'Show me around'}
        </button>
      </div>

      {/* 15.0 — the room's chat. 1.13: instant, with who is typing (features/together/Chat). */}
      <Chat />

      {/* 1.13 — a guest can also ask from anywhere: any song tapped in the app is sent to the host. */}
      <AddSong
        label={mode === 'host' ? 'Add to the queue' : 'Add a song for everyone'}
        note={mode === 'guest' ? `Ask ${hostName ?? 'the host'} to play a song: search here, or tap any song anywhere in VinaX.` : undefined}
      />

      {queue.length > 0 && (
        <section className="vx-lt-block" aria-label="Up next">
          <h2 className="vx-lt-h2">Up next</h2>
          <ul className="vx-group">
            {queue.map((t, i) => (
              <li key={`${t.song.id}-${i}`} className="vx-row">
                <img src={bestImage(t.song.images, 100)} alt="" className="vx-row-art" loading="lazy" />
                <span className="vx-row-main">
                  <span className="vx-row-label truncate-1">{t.song.title}</span>
                  <span className="vx-row-hint truncate-1">{t.by ? `Asked by ${t.by}` : t.song.subtitle}</span>
                </span>
                {/* The host can bring any song that is up next (a guest's request, say) on now. */}
                {mode === 'host' && (
                  <button type="button" className="vx-sec-pill vx-lt-now" onClick={() => playNow(t.song.id)} aria-label={`Play ${t.song.title} now`}>
                    Play now
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="vx-lt-block" aria-labelledby="vx-lt-people">
        <h2 id="vx-lt-people" className="vx-lt-h2 tabular-nums">{Math.max(listenerCount, members.length, names.length, 1)} listening</h2>
        {/* 15.0 — everyone sees the names members chose to give the room. */}
        {(names.length > 0 || mode === 'host') && (
          <ul className="vx-people">
            {(names.length ? names : people).map((m, i) => (
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

      {played.length > 0 && (
        <section className="vx-lt-block" aria-labelledby="vx-lt-history">
          <h2 id="vx-lt-history" className="vx-lt-h2 tabular-nums">{played.length} played this session</h2>
          <button type="button" onClick={saveSession} className="vx-sec-pill">Save this session as a playlist</button>
        </section>
      )}

      {mode === 'guest' && <OpenInApp code={code} />}

      <button type="button" onClick={leaveSession} className="vx-sec-pill is-danger" data-tour="lt-leave">
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

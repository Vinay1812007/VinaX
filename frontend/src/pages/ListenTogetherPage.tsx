import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { usePageTitle } from '@/hooks/usePageTitle';
import { ArtistAvatar } from '@/features/stats/artwork';
import { useCurrentSong, usePlayerStore } from '@/store/playerStore';
import { REACTION_EMOJI } from '@/services/together';
import { useTogether } from '@/services/together/session';
import {
  addSong,
  canTakeOut,
  control,
  getTrimMs,
  joinSession,
  leaveSession,
  playNow,
  react,
  removeFromRoom,
  setGuestControl,
  setOnThisPhone,
  setTrimMs,
  startHosting,
  takeOut,
  tapToListen,
  TRIM_MAX_MS,
  voteToSkip,
} from '@/features/together/engine';
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
import { NextIcon, PauseIcon, PlayIcon, PlusIcon, PrevIcon, UsersIcon, XIcon } from '@/components/Icons';
import { Switch } from '@/components/ui/Switch';
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

/**
 * 1.14 — the jam's play, pause and skip, in the room. The host's buttons work
 * the player; a guest's go to the room and the host's app does them for
 * everyone, unless the host has kept playback to itself.
 */
function Transport(): ReactNode {
  const mode = useTogether((s) => s.mode);
  const guestControl = useTogether((s) => s.guestControl);
  const hostPlaying = useTogether((s) => s.hostPlaying);
  const hostName = useTogether((s) => s.hostName);
  const localPlaying = usePlayerStore((s) => s.isPlaying);
  const host = mode === 'host';
  const playing = host ? localPlaying : hostPlaying;
  const can = host || guestControl;
  const run = (cmd: 'toggle' | 'next' | 'prev'): void => {
    if (!host) return control(cmd);
    const p = usePlayerStore.getState();
    if (cmd === 'toggle') p.togglePlay();
    else if (cmd === 'next') p.next(true);
    else p.prev();
  };
  return (
    <div className="vx-lt-transport" role="group" aria-label="Playback for everyone" data-locked={can ? undefined : 'true'}>
      <div className="vx-lt-transport-row">
        <button type="button" className="vx-lt-tbtn" onClick={() => run('prev')} disabled={!can} aria-label="Previous song">
          <PrevIcon className="w-5 h-5" />
        </button>
        <button type="button" className="vx-lt-tbtn is-main" onClick={() => run('toggle')} disabled={!can} aria-label={playing ? 'Pause for everyone' : 'Play for everyone'}>
          {playing ? <PauseIcon className="w-6 h-6" /> : <PlayIcon className="w-6 h-6" />}
        </button>
        <button type="button" className="vx-lt-tbtn" onClick={() => run('next')} disabled={!can} aria-label="Next song">
          <NextIcon className="w-5 h-5" />
        </button>
      </div>
      <p className="vx-lt-transport-hint">
        {host
          ? guestControl
            ? 'Everyone in the room can play, pause and skip.'
            : 'Only you can play, pause and skip.'
          : guestControl
            ? 'Play, pause and skip for everyone.'
            : `${hostName ?? 'The host'} controls playback. Add songs and vote to skip.`}
      </p>
    </div>
  );
}

/** 1.14 — the room's settings: the host's "guests can control playback", a guest's "play on this phone". */
function JamSettings(): ReactNode {
  const mode = useTogether((s) => s.mode);
  const guestControl = useTogether((s) => s.guestControl);
  const onThisPhone = useTogether((s) => s.onThisPhone);
  const hostName = useTogether((s) => s.hostName);
  if (mode === 'host') {
    return (
      <Switch
        className="vx-lt-switch"
        checked={guestControl}
        onChange={setGuestControl}
        label="Guests can control playback"
        description="Let everyone play, pause and skip. Anyone can always add songs."
      />
    );
  }
  return (
    <Switch
      className="vx-lt-switch"
      checked={onThisPhone}
      onChange={setOnThisPhone}
      label="Play on this phone"
      description={onThisPhone ? 'Turn off when you are in the same room: only the host’s speaker plays, and this phone is the remote.' : `Only ${hostName ?? 'the host'}’s speaker is playing. This phone is the remote.`}
    />
  );
}

/** 1.14 — who is here: the host, you, and (for the host) a way to remove someone. */
function People(): ReactNode {
  const mode = useTogether((s) => s.mode);
  const people = useTogether((s) => s.people);
  const names = useTogether((s) => s.names);
  const members = useTogether((s) => s.members);
  const me = useTogether((s) => s.me);
  const hostH = useTogether((s) => s.hostH);
  const listenerCount = useTogether((s) => s.listenerCount);
  const [confirm, setConfirm] = useState<string | null>(null);
  const count = Math.max(listenerCount, people.length, members.length, names.length, 1);
  // The host first, then you, then everyone else.
  const rank = (h: string): number => (h === hostH ? 0 : h === me ? 1 : 2);
  const list = [...people].sort((a, b) => rank(a.h) - rank(b.h));
  // A server older than 1.14 lists names only.
  const plain = !list.length ? (names.length ? names : mode === 'host' ? (members.length ? members : ['You']) : []) : [];
  return (
    <section className="vx-lt-block" aria-labelledby="vx-lt-people">
      <h2 id="vx-lt-people" className="vx-lt-h2 tabular-nums">{count} in this session</h2>
      {list.length > 0 && (
        <ul className="vx-people">
          {list.map((p) => (
            <li key={p.h} className="vx-person">
              <ArtistAvatar name={p.name} size={36} />
              <span className="min-w-0 truncate-1">{p.name}</span>
              {p.h === hostH && <span className="vx-lt-tag">Host</span>}
              {p.h === me && p.h !== hostH && <span className="vx-lt-tag is-you">You</span>}
              {mode === 'host' && p.h !== me && (
                confirm === p.h ? (
                  <span className="vx-lt-person-ask">
                    <button type="button" className="vx-sec-pill is-danger vx-lt-now" onClick={() => { setConfirm(null); void removeFromRoom(p.h, p.name); }}>
                      Remove
                    </button>
                    <button type="button" className="vx-sec-pill vx-lt-now" onClick={() => setConfirm(null)}>Keep</button>
                  </span>
                ) : (
                  <button type="button" className="vx-lt-x" onClick={() => setConfirm(p.h)} aria-label={`Remove ${p.name} from the session`}>
                    <XIcon className="w-4 h-4" />
                  </button>
                )
              )}
            </li>
          ))}
        </ul>
      )}
      {plain.length > 0 && (
        <ul className="vx-people">
          {plain.map((m, i) => (
            <li key={`${m}-${i}`} className="vx-person">
              <ArtistAvatar name={m} size={36} />
              {m}
            </li>
          ))}
        </ul>
      )}
      <p className="vx-lt-foot">
        {mode === 'host'
          ? 'Everyone hears what plays here, from any page you are on. Leave and the session ends for everyone.'
          : 'Your player follows the room by itself, even while you browse other pages.'}
      </p>
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
          <p className="vx-lt-note">One shared queue for everyone. Friends add songs and can play, pause and skip — you decide.</p>
          <ol className="vx-lt-steps">
            <li>Start — you get a room code and a QR</li>
            <li>Share the link or let friends scan</li>
            <li>Everyone adds songs; everyone hears the same second</li>
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
          <p className="vx-lt-foot">Your player follows the room. Songs you add go straight into the shared queue.</p>
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
  const skipVotes = useTogether((s) => s.skipVotes);
  const guestControl = useTogether((s) => s.guestControl);
  const played = useTogether((s) => s.played);
  const hostName = useTogether((s) => s.hostName);
  const me = useTogether((s) => s.me);
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
            <p className="vx-lt-kicker">{mode === 'host' ? 'Your session · everyone hears' : `${hostName ?? 'The host'}’s session`}</p>
            <p className="vx-lt-song truncate-1">{current?.title ?? (mode === 'host' ? 'Play anything to start' : 'Waiting for the host…')}</p>
            {current && <p className="vx-lt-artist truncate-1">{missing ? 'Not available on this device — the next song will play' : current.subtitle}</p>}
          </div>
        </div>

        <Transport />
        <JamSettings />

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
          {/* 15.0 — vote to skip, while the host keeps playback to itself (1.14: otherwise the transport above skips). */}
          {mode === 'guest' && !guestControl && (
            <button type="button" onClick={() => void voteToSkip()} className="vx-react-btn is-skip" aria-label="Vote to skip this song" title="Vote to skip">
              ⏭{skipVotes > 0 && <span className="vx-react-count">{skipVotes}</span>}
            </button>
          )}
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
        label="Add to the queue"
        note={mode === 'guest' ? 'Songs you add go straight into everyone’s queue: search here, or tap any song anywhere in VinaX.' : 'Anyone in the session can add songs. They play after what is up next.'}
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
                  <span className="vx-row-hint truncate-1">{t.song.subtitle}</span>
                </span>
                {/* 1.14 — who added it, as in a jam. */}
                {t.by && (
                  <span className="vx-lt-added" title={`Added by ${t.by}`}>
                    <ArtistAvatar name={t.by} size={22} />
                    <span className="truncate-1">{t.h && t.h === me ? 'You' : t.by}</span>
                  </span>
                )}
                {/* The host can bring any song that is up next (a guest's, say) on now. */}
                {mode === 'host' && (
                  <button type="button" className="vx-sec-pill vx-lt-now" onClick={() => playNow(t.song.id)} aria-label={`Play ${t.song.title} now`}>
                    Play now
                  </button>
                )}
                {canTakeOut(t) && (
                  <button type="button" className="vx-lt-x" onClick={() => takeOut(t)} aria-label={`Take ${t.song.title} out of the queue`}>
                    <XIcon className="w-4 h-4" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <People />

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
